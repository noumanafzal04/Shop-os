package com.cartze.partner.printing

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID
import kotlin.concurrent.thread

/**
 * THE SLIP, ON PAPER.
 *
 * Two ways out, because shops own two kinds of printer:
 *
 *  - BLUETOOTH THERMAL (58/80 mm, ESC/POS) — what a Pakistani counter has.
 *    The text from `slip.ts` goes out unchanged over the Serial Port Profile,
 *    wrapped in ESC @ (reset) and a feed + cut. Android's print service cannot
 *    see these printers at all, so this is the path that matters.
 *  - ANDROID PRINT — a Wi-Fi/USB printer, or "Save as PDF", through the
 *    system dialog. The slip is laid out as monospaced HTML in a WebView.
 *
 * The chosen Bluetooth printer is remembered (SharedPreferences), so the
 * second slip is one tap. JS asks for BLUETOOTH_CONNECT before calling here.
 */
class SlipPrinterModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "SlipPrinter"

  private val prefs by lazy { ctx.getSharedPreferences("slip_printer", Context.MODE_PRIVATE) }

  private fun adapter(): BluetoothAdapter? =
    (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun pairedPrinters(promise: Promise) {
    try {
      val a = adapter()
      if (a == null) {
        promise.reject("NO_BLUETOOTH", "This phone has no Bluetooth.")
        return
      }
      if (!a.isEnabled) {
        promise.reject("BLUETOOTH_OFF", "Bluetooth is off. Turn it on and try again.")
        return
      }
      val out = Arguments.createArray()
      // Printers first (major class IMAGING), then everything else paired —
      // many cheap thermal printers report no class at all.
      a.bondedDevices
        .sortedBy { if (it.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING) 0 else 1 }
        .forEach { d ->
          val m = Arguments.createMap()
          m.putString("name", d.name ?: d.address)
          m.putString("address", d.address)
          m.putBoolean("looksLikePrinter", d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.IMAGING)
          out.pushMap(m)
        }
      promise.resolve(out)
    } catch (e: SecurityException) {
      promise.reject("NO_PERMISSION", "Allow Nearby devices for this app to reach the printer.")
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun printBluetooth(address: String, text: String, promise: Promise) {
    thread(name = "slip-printer") {
      try {
        val a = adapter() ?: throw IllegalStateException("This phone has no Bluetooth.")
        val device = a.getRemoteDevice(address)
        a.cancelDiscovery()
        val socket = device.createRfcommSocketToServiceRecord(SPP)
        socket.use { s ->
          s.connect()
          val out = s.outputStream
          out.write(byteArrayOf(0x1B, 0x40)) // ESC @ — reset
          out.write(text.replace("\r", "").toByteArray(Charsets.US_ASCII))
          out.write("\n\n\n\n".toByteArray())
          out.write(byteArrayOf(0x1D, 0x56, 0x42, 0x00)) // GS V B 0 — feed and cut
          out.flush()
          // Some printers drop the tail if the socket closes the same instant.
          Thread.sleep(400)
        }
        promise.resolve(true)
      } catch (e: SecurityException) {
        promise.reject("NO_PERMISSION", "Allow Nearby devices for this app to reach the printer.")
      } catch (e: Exception) {
        promise.reject("PRINT_FAILED", "Couldn't reach the printer. Is it on, paired and in range?")
      }
    }
  }

  @ReactMethod
  fun printSystem(text: String, jobName: String, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("NO_SCREEN", "Open the app and try again.")
      return
    }
    Handler(Looper.getMainLooper()).post {
      try {
        val web = WebView(activity)
        web.webViewClient = object : WebViewClient() {
          override fun onPageFinished(view: WebView, url: String?) {
            val pm = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
            pm.print(jobName, view.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().build())
            promise.resolve(true)
          }
        }
        val html = "<html><body style=\"margin:0\"><pre style=\"font-family:monospace;font-size:12px;\">" +
          text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") +
          "</pre></body></html>"
        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
      } catch (e: Exception) {
        promise.reject("PRINT_FAILED", "Couldn't open printing on this phone.")
      }
    }
  }

  @ReactMethod
  fun rememberPrinter(address: String, name: String, promise: Promise) {
    prefs.edit().putString("address", address).putString("name", name).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun forgetPrinter(promise: Promise) {
    prefs.edit().clear().apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun rememberedPrinter(promise: Promise) {
    val address = prefs.getString("address", null)
    if (address == null) {
      promise.resolve(null)
      return
    }
    val m = Arguments.createMap()
    m.putString("address", address)
    m.putString("name", prefs.getString("name", address))
    promise.resolve(m)
  }

  companion object {
    /** The Serial Port Profile every ESC/POS Bluetooth printer speaks. */
    val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  }
}
