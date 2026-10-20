package com.mymusic.player

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

// Settings shared by the module and whatever engine is playing right now.
// They live here (not in the engine) so they survive a song change.
class EightDParams {
  @Volatile var speed = 0.5f       // 0..1  rotation speed (slow .. fast)
  @Volatile var intensity = 0.85f  // 0..1  how far the sound moves (0 = it stays in front on the stage)
  @Volatile var room = 0.65f       // 0..1  hall size (small club .. huge cathedral)
  @Volatile var reverb = 0.6f      // 0..1  how much of the hall you hear
  @Volatile var bass = 0.5f        // 0..1  0.5 = normal, 0 = -12 dB, 1 = +12 dB
  @Volatile var tilt = false       // false = automatic rotation, true = phone tilt
  @Volatile var tiltTarget = 0f    // -1 (left) .. +1 (right), written by the motion sensor
}

// A 2nd order filter (Butterworth). Two of them in a row make a Linkwitz-Riley crossover.
private class Biquad {
  private var b0 = 1.0
  private var b1 = 0.0
  private var b2 = 0.0
  private var a1 = 0.0
  private var a2 = 0.0
  private var z1 = 0.0
  private var z2 = 0.0

  fun design(sr: Int, fc: Double, high: Boolean) {
    val w = 2.0 * PI * fc / sr
    val cw = cos(w)
    val alpha = sin(w) / (2.0 * 0.70710678)
    val a0 = 1.0 + alpha
    if (high) {
      b0 = (1.0 + cw) / 2.0 / a0
      b1 = -(1.0 + cw) / a0
    } else {
      b0 = (1.0 - cw) / 2.0 / a0
      b1 = (1.0 - cw) / a0
    }
    b2 = b0
    a1 = -2.0 * cw / a0
    a2 = (1.0 - alpha) / a0
  }

  fun tick(x: Double): Double {
    val y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }

  fun reset() {
    z1 = 0.0
    z2 = 0.0
  }
}

// Schroeder all-pass: smears the sound in time without changing its colour (makes the reverb smooth)
private class Allpass(len: Int, private val g: Float) {
  private val buf = FloatArray(len)
  private var pos = 0

  fun tick(x: Float): Float {
    val d = buf[pos]
    val w = x + g * d
    buf[pos] = w
    pos++
    if (pos >= buf.size) pos = 0
    return d - g * w
  }

  fun reset() {
    buf.fill(0f)
    pos = 0
  }
}

// Reads a ring buffer "d" samples in the past (d can have a fraction)
private fun readFrac(buf: FloatArray, writePos: Int, d: Float): Float {
  val n = buf.size
  val di = d.toInt()
  val f = d - di
  var i0 = writePos - di
  while (i0 < 0) i0 += n
  var i1 = i0 - 1
  if (i1 < 0) i1 += n
  return buf[i0] * (1f - f) + buf[i1] * f
}

// The 8D concert hall.
//
//  1. Bass (below 150 Hz) is split off. It stays in the centre, dry and clean, and the Bass slider changes it.
//  2. The rest is placed in a virtual hall:
//       - the singer (centre of the song) moves around you: tiny time difference + head shadow + front/back
//         brightness for each ear, and it gets closer when it passes your ear
//       - the band (left/right difference of the song) stays on the stage in front of you
//       - early reflections bounce off the side walls (this is what pushes the sound OUT of your head)
//       - a big hall reverb (8 lines, smooth, dark at the top like real air) wraps around you
//  3. A limiter keeps loud songs with big bass from distorting.
class EightDDsp(private val sr: Int, private val params: EightDParams) {
  private val scale = sr / 44100f

  // ----- bass split (Linkwitz-Riley 4th order at 150 Hz) -----
  private val lowA = Biquad()
  private val lowB = Biquad()
  private val highLA = Biquad()
  private val highLB = Biquad()
  private val highRA = Biquad()
  private val highRB = Biquad()

  // ----- smoothed copies of the settings, so moving a slider never clicks -----
  private var roomS = params.room
  private var reverbS = params.reverb
  private var speedS = params.speed
  private var intensityS = params.intensity
  private var bassS = params.bass
  private var bassGainS = 1f // these four glide per sample, so dragging a slider never clicks
  private var wetErS = 0f
  private var wetLateS = 0f
  private var dryBaseS = 1f

  // ----- the moving singer -----
  private var phase = 0.0
  private var xS = 0f
  private var bS = 0f
  private val monoBuf = FloatArray((0.002f * sr).toInt() + 16)
  private var monoPos = 0
  private var earL = 0f
  private var earR = 0f
  private var shelfL = 0f
  private var shelfR = 0f
  private var coefL = 1f
  private var coefR = 1f
  private val coefShelf = (1.0 - exp(-2.0 * PI * 3500.0 / sr)).toFloat()
  private var tick = 0
  private val maxItd = 0.0007f * sr // longest time difference between the ears (about 0.7 ms)

  // ----- early reflections -----
  private val erLen = (0.14f * sr).toInt() + 8
  private val erL = FloatArray(erLen)
  private val erR = FloatArray(erLen)
  private var erPos = 0
  private val erMs = floatArrayOf(7.3f, 11.9f, 17.3f, 23.9f, 31.1f, 39.7f, 49.3f, 61.1f)
  private val erGain = floatArrayOf(0.60f, 0.53f, 0.47f, 0.41f, 0.35f, 0.29f, 0.23f, 0.18f)
  private var erScale = 0.7f + 0.8f * params.room
  private var erLpL = 0f
  private var erLpR = 0f
  private val erLpCoef = (1.0 - exp(-2.0 * PI * 5500.0 / sr)).toFloat()

  // ----- hall reverb -----
  private val preLen = (0.03f * sr).toInt() + 8
  private val preBuf = FloatArray(preLen)
  private var prePos = 0
  private val preDelay = 0.026f * sr
  private var inHp = 0f
  private val inHpCoef = (1.0 - exp(-2.0 * PI * 200.0 / sr)).toFloat()
  private val diff = arrayOf(
    Allpass(max(8, (142 * scale).toInt()), 0.6f),
    Allpass(max(8, (107 * scale).toInt()), 0.6f),
    Allpass(max(8, (379 * scale).toInt()), 0.6f),
    Allpass(max(8, (277 * scale).toInt()), 0.6f)
  )
  private val fdnBase = intArrayOf(1051, 1303, 1523, 1789, 2017, 2297, 2593, 2879)
  private val fdnLen = IntArray(8) { max(64, (fdnBase[it] * scale).toInt()) }
  private val fdnBuf = Array(8) { FloatArray(fdnLen[it] + 48) }
  private val fdnPos = IntArray(8)
  private val fdnLp = FloatArray(8)
  private val fdnG = FloatArray(8)
  private val fdnY = FloatArray(8)
  private val fdnT = FloatArray(8)
  private val modPhase = DoubleArray(8) { it * 0.8 }
  private val modInc = DoubleArray(8) { 2.0 * PI * (0.07 + 0.021 * it) / sr }
  private val modDepth = 3.0f * scale
  private var lastRt = -1f

  // ----- limiter -----
  private var env = 0f
  private var gainS = 1f

  init {
    lowA.design(sr, 150.0, false)
    lowB.design(sr, 150.0, false)
    highLA.design(sr, 150.0, true)
    highLB.design(sr, 150.0, true)
    highRA.design(sr, 150.0, true)
    highRB.design(sr, 150.0, true)
    updateFeedback(0.8f + 2.8f * roomS)
    bassGainS = 10f.pow((bassS - 0.5f) * 24f / 20f)
    wetErS = 0.95f * reverbS
    wetLateS = 1.5f * reverbS
    dryBaseS = 1f - 0.25f * roomS
  }

  fun reset() {
    lowA.reset(); lowB.reset()
    highLA.reset(); highLB.reset(); highRA.reset(); highRB.reset()
    monoBuf.fill(0f)
    earL = 0f; earR = 0f; shelfL = 0f; shelfR = 0f
    erL.fill(0f); erR.fill(0f)
    erLpL = 0f; erLpR = 0f
    preBuf.fill(0f)
    inHp = 0f
    for (a in diff) a.reset()
    for (b in fdnBuf) b.fill(0f)
    fdnLp.fill(0f)
    env = 0f
    gainS = 1f
  }

  // How long the hall rings: reverb time in seconds -> how much each line keeps per trip
  private fun updateFeedback(rt: Float) {
    if (abs(rt - lastRt) < 0.002f) return
    lastRt = rt
    for (i in 0 until 8) {
      val dSec = fdnLen[i] / sr.toFloat()
      fdnG[i] = 10f.pow(-3f * dSec / rt)
    }
  }

  // inp: interleaved L R floats (-1..1). out: same.
  fun process(inp: FloatArray, out: FloatArray, frames: Int) {
    // ease the settings towards what the sliders say (once per block)
    roomS += (params.room - roomS) * 0.25f
    reverbS += (params.reverb - reverbS) * 0.25f
    speedS += (params.speed - speedS) * 0.25f
    intensityS += (params.intensity - intensityS) * 0.25f
    bassS += (params.bass - bassS) * 0.25f

    val tilt = params.tilt
    val period = 16.0 - 13.0 * speedS // seconds for one full turn: 16 s (slow) .. 3 s (fast)
    val step = 2.0 * PI / (sr * period)
    val inten = intensityS

    val rt = 0.8f + 2.8f * roomS // hall echo time: 0.8 s .. 3.6 s
    updateFeedback(rt)
    val damp = 0.14f + 0.14f * roomS // bigger hall = more air = darker tail
    val erTarget = 0.7f + 0.8f * roomS
    val wetErT = 0.95f * reverbS
    val wetLateT = 1.5f * reverbS
    val dryBaseT = 1f - 0.25f * roomS // a bigger hall puts the singer further away
    val stage = 0.6f // how wide the band stays on the stage
    val kPan = if (tilt) 0.0006f else 0.004f

    val bassDb = (bassS - 0.5f) * 24f // -12 dB .. +12 dB
    val bassGainT = 10f.pow(bassDb / 20f)

    for (i in 0 until frames) {
      bassGainS += (bassGainT - bassGainS) * 0.002f
      wetErS += (wetErT - wetErS) * 0.002f
      wetLateS += (wetLateT - wetLateS) * 0.002f
      dryBaseS += (dryBaseT - dryBaseS) * 0.002f

      val l = inp[i * 2]
      val r = inp[i * 2 + 1]

      // ---- 1. split the bass off ----
      val mn = (l + r) * 0.5 + 1.0e-20
      val low = lowB.tick(lowA.tick(mn)).toFloat() * bassGainS
      val hl = highLB.tick(highLA.tick(l + 1.0e-20)).toFloat()
      val hr = highRB.tick(highRA.tick(r + 1.0e-20)).toFloat()
      val mid = (hl + hr) * 0.5f // the singer
      val side = (hl - hr) * 0.5f // the band

      // ---- 2. where is the singer? ----
      val xT: Float
      val bT: Float
      if (tilt) {
        xT = params.tiltTarget * inten
        bT = 0f
      } else {
        xT = sin(phase).toFloat() * inten // -1 left .. +1 right
        bT = max(0f, -cos(phase).toFloat()) * inten // 0 front .. 1 behind you
        phase += step
        if (phase > 2.0 * PI) phase -= 2.0 * PI
      }
      xS += kPan * (xT - xS)
      bS += kPan * (bT - bS)
      val x = max(-1f, min(1f, xS))
      val back = max(0f, min(1f, bS))
      val ax = abs(x)

      // time difference between the ears (Woodworth head model)
      val th = asin(x.toDouble()).toFloat()
      val itd = maxItd * (th + sin(th)) / (1.5707964f + 1f)
      val dL = max(0f, itd)
      val dR = max(0f, -itd)
      monoBuf[monoPos] = mid
      var eL = readFrac(monoBuf, monoPos, dL)
      var eR = readFrac(monoBuf, monoPos, dR)
      monoPos++
      if (monoPos >= monoBuf.size) monoPos = 0

      // head shadow: the far ear loses high notes. Behind you is darker for both ears.
      if ((tick and 7) == 0) {
        val backK = 1f - 0.65f * back
        val fcNear = 24000f * backK
        val fcFar = (24000f - 21500f * ax) * backK
        val fcL = if (x > 0f) fcFar else fcNear
        val fcR = if (x > 0f) fcNear else fcFar
        coefL = min(1f, (1.0 - exp(-2.0 * PI * fcL / sr)).toFloat())
        coefR = min(1f, (1.0 - exp(-2.0 * PI * fcR / sr)).toFloat())
      }
      tick++
      earL += coefL * (eL - earL)
      earR += coefR * (eR - earR)
      eL = earL
      eR = earR

      // in front the sound is a little brighter (crisp), and it is louder when it passes close to an ear
      val presence = 0.3f * (1f - back)
      shelfL += coefShelf * (eL - shelfL)
      shelfR += coefShelf * (eR - shelfR)
      eL += presence * (eL - shelfL)
      eR += presence * (eR - shelfR)
      val gDry = dryBaseS * (0.85f + 0.4f * ax) * (1f - 0.18f * back)
      eL *= gDry
      eR *= gDry

      // the band stays on the stage in front
      val stageSide = side * stage
      val dryL = eL + stageSide
      val dryR = eR - stageSide

      // ---- 3. early reflections off the side walls ----
      erL[erPos] = dryL
      erR[erPos] = dryR
      erScale += (erTarget - erScale) * 0.00015f
      var rl = 0f
      var rr = 0f
      for (k in 0 until 8) {
        val dl = erMs[k] * 0.001f * sr * erScale
        val dr = dl * 1.07f + 0.0004f * sr
        val g = erGain[k]
        if ((k and 1) == 0) {
          rl += g * readFrac(erR, erPos, dl)
          rr += g * readFrac(erL, erPos, dr)
        } else {
          rl += g * readFrac(erL, erPos, dl)
          rr += g * readFrac(erR, erPos, dr)
        }
      }
      erPos++
      if (erPos >= erLen) erPos = 0
      erLpL += erLpCoef * (rl - erLpL)
      erLpR += erLpCoef * (rr - erLpR)

      // ---- 4. the hall (late reverb) ----
      val send = (dryL + dryR) * 0.5f
      preBuf[prePos] = send
      var rin = readFrac(preBuf, prePos, preDelay)
      prePos++
      if (prePos >= preLen) prePos = 0
      inHp += inHpCoef * (rin - inHp)
      rin -= inHp // no bass in the reverb: it stays clean and crisp
      for (a in diff) rin = a.tick(rin)

      var outL = 0f
      var outR = 0f
      for (k in 0 until 8) {
        val buf = fdnBuf[k]
        val d = fdnLen[k] + modDepth * sin(modPhase[k]).toFloat()
        modPhase[k] += modInc[k]
        val y = readFrac(buf, fdnPos[k], d)
        fdnY[k] = y
        fdnLp[k] = y * (1f - damp) + fdnLp[k] * damp + 1.0e-15f
        fdnT[k] = fdnLp[k] * fdnG[k]
      }
      // mix the 8 lines together (Hadamard)
      var h = 1
      while (h < 8) {
        var a = 0
        while (a < 8) {
          for (j in a until a + h) {
            val p = fdnT[j]
            val q = fdnT[j + h]
            fdnT[j] = p + q
            fdnT[j + h] = p - q
          }
          a += h * 2
        }
        h *= 2
      }
      for (k in 0 until 8) {
        val buf = fdnBuf[k]
        buf[fdnPos[k]] = fdnT[k] * 0.35355339f + rin * 0.35f
        fdnPos[k]++
        if (fdnPos[k] >= buf.size) fdnPos[k] = 0
        val y = fdnY[k]
        // different mixes for the left and right ear: that is what makes the hall wrap around you
        if ((k and 1) == 0) outL += y else outL -= y
        if ((k and 2) == 0) outR += y else outR -= y
      }
      outL *= 0.35f
      outR *= 0.35f

      // ---- 5. put it all together: stage + hall + clean bass ----
      var oL = dryL + erLpL * wetErS + outL * wetLateS + low
      var oR = dryR + erLpR * wetErS + outR * wetLateS + low

      // ---- 6. limiter, so a big bass boost never crackles ----
      val pk = max(abs(oL), abs(oR))
      env = if (pk > env) pk else env + (pk - env) * 0.0003f
      val gT = if (env > 0.85f) 0.85f / env else 1f
      gainS += (gT - gainS) * (if (gT < gainS) 0.35f else 0.0008f)
      oL = soft(oL * gainS)
      oR = soft(oR * gainS)

      out[i * 2] = oL
      out[i * 2 + 1] = oR
    }
  }

  private fun soft(x: Float): Float {
    val ax = abs(x)
    return if (ax < 0.8f) x else (if (x > 0f) 1f else -1f) * (0.8f + 0.2f * (1f - exp(-((ax - 0.8f) * 5f))))
  }
}
