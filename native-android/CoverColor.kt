package com.mymusic.player

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.FileInputStream
import java.io.InputStream

// Finds the main color of a cover picture (and a second color if the picture has one).
class CoverColorModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = "CoverColor"

  private fun open(uri: String): InputStream? {
    return try {
      if (uri.startsWith("content://")) {
        ctx.contentResolver.openInputStream(Uri.parse(uri))
      } else {
        FileInputStream(if (uri.startsWith("file://")) uri.substring(7) else uri)
      }
    } catch (e: Throwable) {
      null
    }
  }

  private fun hex(r: Int, g: Int, b: Int): String = String.format("#%02X%02X%02X", r, g, b)

  @ReactMethod
  fun getColors(uri: String, promise: Promise) {
    Thread {
      try {
        val bounds = BitmapFactory.Options()
        bounds.inJustDecodeBounds = true
        open(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val side = maxOf(bounds.outWidth, bounds.outHeight)
        if (side <= 0) {
          promise.resolve(null)
          return@Thread
        }
        var sample = 1
        while (side / sample > 256) sample *= 2
        val opts = BitmapFactory.Options()
        opts.inSampleSize = sample
        val bmp = open(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        if (bmp == null) {
          promise.resolve(null)
          return@Thread
        }
        val small = Bitmap.createScaledBitmap(bmp, 40, 40, true)

        val weight = DoubleArray(12)
        val sr = DoubleArray(12)
        val sg = DoubleArray(12)
        val sb = DoubleArray(12)
        var allR = 0.0
        var allG = 0.0
        var allB = 0.0
        var total = 0.0
        val hsv = FloatArray(3)
        for (y in 0 until 40) {
          for (x in 0 until 40) {
            val px = small.getPixel(x, y)
            val r = Color.red(px)
            val g = Color.green(px)
            val b = Color.blue(px)
            allR += r
            allG += g
            allB += b
            total += 1.0
            Color.colorToHSV(px, hsv)
            val s = hsv[1]
            val v = hsv[2]
            if (v < 0.12f || s < 0.18f) continue
            val w = (s * (0.35f + v)).toDouble()
            val bucket = (hsv[0] / 30f).toInt() % 12
            weight[bucket] += w
            sr[bucket] += r * w
            sg[bucket] += g * w
            sb[bucket] += b * w
          }
        }

        var top = 0
        for (i in 1 until 12) if (weight[i] > weight[top]) top = i
        val arr = Arguments.createArray()
        if (weight[top] < total * 0.04) {
          // almost no color in the picture: use its average gray
          val c = hex((allR / total).toInt(), (allG / total).toInt(), (allB / total).toInt())
          arr.pushString(c)
          arr.pushString(c)
        } else {
          val main = hex((sr[top] / weight[top]).toInt(), (sg[top] / weight[top]).toInt(), (sb[top] / weight[top]).toInt())
          var second = -1
          for (i in 0 until 12) {
            val d = Math.abs(i - top)
            if (d <= 1 || d >= 11) continue
            if (second < 0 || weight[i] > weight[second]) second = i
          }
          arr.pushString(main)
          if (second >= 0 && weight[second] > weight[top] * 0.35) {
            arr.pushString(hex((sr[second] / weight[second]).toInt(), (sg[second] / weight[second]).toInt(), (sb[second] / weight[second]).toInt()))
          } else {
            arr.pushString(main)
          }
        }
        promise.resolve(arr)
      } catch (e: Throwable) {
        promise.resolve(null)
      }
    }.start()
  }
}
