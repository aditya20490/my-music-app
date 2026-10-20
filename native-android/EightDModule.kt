package com.mymusic.player

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Bridge to JS. The normal player keeps running (muted) as the clock and media session;
// this plays the same file with the 8D effect on top.
class EightDModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private var engine: EightDEngine? = null
  private val params = EightDParams()

  override fun getName(): String = "EightD"

  @ReactMethod
  fun start(uri: String, posMs: Double, volume: Double, playing: Boolean, promise: Promise) {
    try {
      engine?.release()
      val e = EightDEngine(reactApplicationContext.applicationContext, uri, posMs.toLong(), volume.toFloat(), playing, params)
      engine = e
      e.begin()
      promise.resolve(true)
    } catch (t: Throwable) {
      promise.reject("EIGHTD", t.message ?: "8D failed")
    }
  }

  @ReactMethod
  fun stop() {
    engine?.release()
    engine = null
  }

  @ReactMethod
  fun setPlaying(p: Boolean) {
    engine?.playing = p
  }

  @ReactMethod
  fun seekTo(ms: Double) {
    engine?.seekReq = ms.toLong()
  }

  @ReactMethod
  fun setVolume(v: Double) {
    engine?.volume = v.toFloat()
  }

  // speed, intensity, room, reverb, bass are 0..1 (bass 0.5 = normal). tilt = true switches to phone-tilt mode.
  @ReactMethod
  fun setParams(speed: Double, intensity: Double, room: Double, reverb: Double, bass: Double, tilt: Boolean) {
    params.speed = speed.toFloat().coerceIn(0f, 1f)
    params.intensity = intensity.toFloat().coerceIn(0f, 1f)
    params.room = room.toFloat().coerceIn(0f, 1f)
    params.reverb = reverb.toFloat().coerceIn(0f, 1f)
    params.bass = bass.toFloat().coerceIn(0f, 1f)
    params.tilt = tilt
    engine?.syncTilt()
  }

  // Does this phone have a motion sensor we can use? (No permission is needed for it.)
  @ReactMethod
  fun tiltAvailable(promise: Promise) {
    try {
      val sm = reactApplicationContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      promise.resolve(sm != null && sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null)
    } catch (t: Throwable) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getPosition(promise: Promise) {
    promise.resolve((engine?.positionMs() ?: -1L).toDouble())
  }
}

class EightDEngine(
  private val ctx: Context,
  private val uri: String,
  startMs: Long,
  @Volatile var volume: Float,
  @Volatile var playing: Boolean,
  private val params: EightDParams
) {
  @Volatile var seekReq: Long = startMs
  @Volatile private var stopped = false
  @Volatile private var baseMs = 0L
  @Volatile private var rate = 44100
  @Volatile private var track: AudioTrack? = null
  private var thread: Thread? = null

  // ---------- motion sensor (tilt mode) ----------
  private val sm: SensorManager? = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
  private var tiltOn = false
  private val sensorListener = object : SensorEventListener {
    override fun onSensorChanged(e: SensorEvent) {
      // x is the sideways axis: tilting the right edge down makes x negative
      var v = -e.values[0] / 4.9f // about 30 degrees of tilt = full left / right
      val dead = 0.06f
      v = if (abs(v) < dead) 0f else (if (v > 0) 1f else -1f) * (abs(v) - dead) / (1f - dead)
      v = max(-1f, min(1f, v))
      params.tiltTarget += (v - params.tiltTarget) * 0.2f // smooth the sensor
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  @Synchronized
  fun syncTilt() {
    val want = params.tilt && !stopped
    if (want && !tiltOn) {
      val s = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      if (s != null) {
        // SENSOR_DELAY_GAME is about 50 updates a second: no special permission needed
        tiltOn = sm.registerListener(sensorListener, s, SensorManager.SENSOR_DELAY_GAME)
      }
    } else if (!want && tiltOn) {
      try { sm?.unregisterListener(sensorListener) } catch (e: Throwable) {}
      tiltOn = false
      params.tiltTarget = 0f
    }
  }

  fun begin() {
    syncTilt()
    val t = Thread({ run() }, "eightd-decoder")
    t.isDaemon = true
    thread = t
    t.start()
  }

  fun release() {
    stopped = true
    syncTilt()
  }

  fun positionMs(): Long {
    val tr = track ?: return -1L
    return try {
      baseMs + (tr.playbackHeadPosition.toLong() and 0xFFFFFFFFL) * 1000L / rate
    } catch (e: Throwable) {
      -1L
    }
  }

  private fun makeTrack(sr: Int): AudioTrack {
    val min = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
    val size = max(min * 2, sr * 4 / 4)
    return AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(sr)
          .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
          .build()
      )
      .setBufferSizeInBytes(size)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private fun run() {
    var extractor: MediaExtractor? = null
    var codec: MediaCodec? = null
    try {
      extractor = MediaExtractor()
      extractor.setDataSource(ctx, Uri.parse(uri), null)
      var idx = -1
      var fmt: MediaFormat? = null
      for (i in 0 until extractor.trackCount) {
        val f = extractor.getTrackFormat(i)
        if ((f.getString(MediaFormat.KEY_MIME) ?: "").startsWith("audio/")) {
          idx = i; fmt = f; break
        }
      }
      if (idx < 0 || fmt == null) return
      extractor.selectTrack(idx)
      codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(fmt, null, null, 0)
      codec.start()

      var sr = if (fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE)) fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
      var ch = if (fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
      rate = sr
      var tr = makeTrack(sr)
      track = tr
      var dsp = EightDDsp(sr, params)
      var trackPlaying = false

      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var outputDone = false
      var skipUntilUs = 0L
      var inF = FloatArray(4096 * 2)
      var outF = FloatArray(4096 * 2)
      var pcm = ShortArray(4096 * 2)

      while (!stopped) {
        // seek request
        val sk = seekReq
        if (sk >= 0) {
          seekReq = -1
          val us = sk * 1000L
          extractor.seekTo(us, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
          codec.flush()
          inputDone = false
          outputDone = false
          skipUntilUs = us
          baseMs = sk
          try { tr.pause(); tr.flush(); trackPlaying = false } catch (e: Throwable) {}
          dsp.reset()
        }

        // pause / resume
        if (!playing) {
          if (trackPlaying) { try { tr.pause() } catch (e: Throwable) {}; trackPlaying = false }
          Thread.sleep(25)
          continue
        }

        if (outputDone) { Thread.sleep(50); continue }

        if (!inputDone) {
          val ib = codec.dequeueInputBuffer(0)
          if (ib >= 0) {
            val buf = codec.getInputBuffer(ib)!!
            val n = extractor.readSampleData(buf, 0)
            if (n < 0) {
              codec.queueInputBuffer(ib, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(ib, 0, n, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }

        val ob = codec.dequeueOutputBuffer(info, 5000)
        if (ob == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val nf = codec.outputFormat
          val nsr = if (nf.containsKey(MediaFormat.KEY_SAMPLE_RATE)) nf.getInteger(MediaFormat.KEY_SAMPLE_RATE) else sr
          ch = if (nf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else ch
          if (nsr != sr) {
            try { tr.release() } catch (e: Throwable) {}
            sr = nsr
            rate = sr
            tr = makeTrack(sr)
            track = tr
            dsp = EightDDsp(sr, params)
            trackPlaying = false
          }
        } else if (ob >= 0) {
          if (info.size > 0 && info.presentationTimeUs >= skipUntilUs) {
            val bb = codec.getOutputBuffer(ob)!!
            bb.position(info.offset)
            bb.limit(info.offset + info.size)
            val sb = bb.order(java.nio.ByteOrder.nativeOrder()).asShortBuffer()
            val total = sb.remaining()
            val frames = total / max(1, ch)
            if (inF.size < frames * 2) { inF = FloatArray(frames * 2); outF = FloatArray(frames * 2); pcm = ShortArray(frames * 2) }
            val tmp = ShortArray(total)
            sb.get(tmp)
            for (f in 0 until frames) {
              val l: Float
              val r: Float
              if (ch == 1) {
                l = tmp[f] / 32768f; r = l
              } else {
                l = tmp[f * ch] / 32768f; r = tmp[f * ch + 1] / 32768f
              }
              inF[f * 2] = l
              inF[f * 2 + 1] = r
            }
            dsp.process(inF, outF, frames)
            val v = volume
            for (k in 0 until frames * 2) {
              pcm[k] = (max(-1f, min(1f, outF[k] * v)) * 32767f).toInt().toShort()
            }
            if (!trackPlaying) { try { tr.play() } catch (e: Throwable) {}; trackPlaying = true }
            var off = 0
            val len = frames * 2
            while (off < len && !stopped && seekReq < 0 && playing) {
              val w = tr.write(pcm, off, len - off, AudioTrack.WRITE_NON_BLOCKING)
              if (w < 0) break
              if (w == 0) Thread.sleep(5) else off += w
            }
          }
          codec.releaseOutputBuffer(ob, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        }
      }
    } catch (t: Throwable) {
      // the normal player is muted while 8D is on, so tell JS by leaving position at -1
    } finally {
      try { track?.stop() } catch (e: Throwable) {}
      try { track?.release() } catch (e: Throwable) {}
      track = null
      try { codec?.stop() } catch (e: Throwable) {}
      try { codec?.release() } catch (e: Throwable) {}
      try { extractor?.release() } catch (e: Throwable) {}
    }
  }
}
