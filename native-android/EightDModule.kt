package com.mymusic.player

import android.content.Context
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
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

// Bridge to JS. The normal player keeps running (muted) as the clock and media session;
// this plays the same file with the 8D effect on top.
class EightDModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private var engine: EightDEngine? = null

  override fun getName(): String = "EightD"

  @ReactMethod
  fun start(uri: String, posMs: Double, volume: Double, playing: Boolean, promise: Promise) {
    try {
      engine?.release()
      val e = EightDEngine(reactApplicationContext.applicationContext, uri, posMs.toLong(), volume.toFloat(), playing)
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
  @Volatile var playing: Boolean
) {
  @Volatile var seekReq: Long = startMs
  @Volatile private var stopped = false
  @Volatile private var baseMs = 0L
  @Volatile private var rate = 44100
  @Volatile private var track: AudioTrack? = null
  private var thread: Thread? = null

  fun begin() {
    val t = Thread({ run() }, "eightd-decoder")
    t.isDaemon = true
    thread = t
    t.start()
  }

  fun release() {
    stopped = true
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

  // ---------- The 8D effect ----------
  private class Dsp(var sr: Int) {
    var phase = 0.0
    val maxDelay = 40
    var dl = FloatArray(maxDelay + 2)
    var dr = FloatArray(maxDelay + 2)
    var dpos = 0
    var lpL = 0f
    var lpR = 0f
    // little reverb: 4 comb filters per side
    val combMs = floatArrayOf(29.7f, 37.1f, 41.1f, 43.7f)
    var combL = Array(4) { FloatArray((combMs[it] * sr / 1000f).toInt() + 1) }
    var combR = Array(4) { FloatArray(((combMs[it] + 1.7f) * sr / 1000f).toInt() + 1) }
    val ci = IntArray(4)

    fun reset() {
      dl.fill(0f); dr.fill(0f); lpL = 0f; lpR = 0f
      for (c in combL) c.fill(0f)
      for (c in combR) c.fill(0f)
    }

    // in: interleaved L R floats (-1..1). out: same.
    fun process(inp: FloatArray, out: FloatArray, frames: Int) {
      val step = 2.0 * PI / (sr * 8.0) // one full turn every 8 seconds
      for (i in 0 until frames) {
        val l = inp[i * 2]
        val r = inp[i * 2 + 1]
        val mid = (l + r) * 0.5f
        val side = (l - r) * 0.5f
        val p = sin(phase).toFloat() // -1 left .. +1 right
        val back = max(0f, -cos(phase).toFloat()) // 0 front .. 1 behind
        phase += step
        if (phase > 2 * PI) phase -= 2 * PI

        // equal power pan of the centre
        val ang = (p + 1f) * (PI.toFloat() / 4f)
        var ml = mid * cos(ang) * 1.4142f
        var mr = mid * sin(ang) * 1.4142f

        // tiny delay on the far ear
        dl[dpos] = ml
        dr[dpos] = mr
        val dlyL = max(0f, p) * (maxDelay - 2) * 0.6f
        val dlyR = max(0f, -p) * (maxDelay - 2) * 0.6f
        ml = frac(dl, dpos, dlyL)
        mr = frac(dr, dpos, dlyR)
        dpos = (dpos + 1) % dl.size

        // sound behind you is darker and a bit quieter
        val a = 1f - 0.75f * back
        lpL += a * (ml - lpL)
        lpR += a * (mr - lpR)
        val g = 1f - 0.2f * back
        var ol = lpL * g + side * 0.35f
        var or = lpR * g - side * 0.35f

        // reverb
        var wl = 0f
        var wr = 0f
        for (k in 0 until 4) {
          val bl = combL[k]
          val br = combR[k]
          val idx = ci[k]
          val il = idx % bl.size
          val ir = idx % br.size
          val yl = bl[il]
          val yr = br[ir]
          bl[il] = mid + yl * 0.55f
          br[ir] = mid + yr * 0.55f
          wl += yl
          wr += yr
          ci[k] = idx + 1
        }
        ol += wl * 0.07f
        or += wr * 0.07f

        out[i * 2] = soft(ol * 0.9f)
        out[i * 2 + 1] = soft(or * 0.9f)
      }
    }

    private fun frac(buf: FloatArray, pos: Int, d: Float): Float {
      val n = buf.size
      val di = d.toInt()
      val f = d - di
      val a = buf[((pos - di) % n + n) % n]
      val b = buf[((pos - di - 1) % n + n) % n]
      return a * (1f - f) + b * f
    }

    private fun soft(x: Float): Float {
      val ax = abs(x)
      return if (ax < 0.8f) x else (if (x > 0) 1f else -1f) * (0.8f + 0.2f * (1f - Math.exp(-((ax - 0.8f) * 5.0)).toFloat()))
    }
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
      var dsp = Dsp(sr)
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
            dsp = Dsp(sr)
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
