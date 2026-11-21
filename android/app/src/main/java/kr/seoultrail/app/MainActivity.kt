package kr.seoultrail.app

import android.Manifest
import android.app.Activity
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.*
import android.webkit.*
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var serverAPI: NativeServerAPI
    private var pendingAction = "locate"
    private var pendingConfig = "{}"
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var ready = false
    private var exportContent: String? = null
    private val origin = "https://appassets.androidplatform.net"
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent?.getStringExtra("error")?.let { error(it) }
            val fix = intent?.getStringExtra("fix")
            if (fix == null) flushLocations()
            else if (ready) runCatching { JSONObject(fix) }.getOrNull()?.let {
                web.evaluateJavascript("window.onTrailLocation?.($it)", null)
            }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        serverAPI = NativeServerAPI(applicationContext)
        setContentView(web)
        if (Build.VERSION.SDK_INT >= 35) web.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom)
            insets
        }
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = true
        web.addJavascriptInterface(Bridge(), "AndroidTrail")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val uri = request?.url ?: return null
                if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net") return null
                val relative = if (uri.path == "/" || uri.path.isNullOrEmpty()) "index.html" else uri.path!!.removePrefix("/")
                if (relative.contains("..")) return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                val mime = when (relative.substringAfterLast('.')) { "js" -> "text/javascript"; "css" -> "text/css"; "svg" -> "image/svg+xml"; "webmanifest" -> "application/manifest+json"; else -> "text/html" }
                return try { WebResourceResponse(mime, "UTF-8", assets.open("web/$relative")) } catch (_: Exception) { WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
            }
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return true
                if (uri.scheme == "https" && uri.host == "appassets.androidplatform.net") return false
                if (uri.scheme == "https") runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = callback
                val photos = params?.acceptTypes?.any { it.startsWith("image/") } == true
                return try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    type=if(photos) "image/*" else "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }, 201); true } catch (_: Exception) { fileCallback?.onReceiveValue(null); fileCallback=null; false }
            }
        }
        web.loadUrl("$origin/index.html")
    }
    inner class Bridge {
        @JavascriptInterface fun postMessage(message: String) { runOnUiThread {
            val action = runCatching { JSONObject(message).getString("action") }.getOrDefault("")
            if (action == "start") pendingConfig = message
            when(action) {
                "api" -> serverAPI.request(JSONObject(message)) { result -> runOnUiThread {
                    if (!isDestroyed) web.evaluateJavascript("window.onTrailAPI?.(${result})", null)
                } }
                "ready" -> { ready = true; flushLocations() }
                "replay-gps" -> {
                    val id = JSONObject(message).optString("sessionId")
                    val points = runCatching { savedLocations() }.getOrNull()
                    val payload = points?.joinToString(",", "[", "]") ?: "null"
                    web.evaluateJavascript("window.onTrailRecovery?.($payload,${JSONObject.quote(id)})", null)
                }
                "start", "locate" -> requestLocation(action)
                "stop" -> stopService(Intent(this@MainActivity, TrailLocationService::class.java))
                "export" -> {
                    if (exportContent != null) { error("파일 저장 창을 먼저 닫아 주세요."); return@runOnUiThread }
                    val objectData = runCatching { JSONObject(message) }.getOrNull() ?: return@runOnUiThread
                    val content = objectData.optString("content")
                    if (content.toByteArray(Charsets.UTF_8).size > 16 * 1024 * 1024) { error("기록이 너무 큽니다. 이전 기록을 나누어 정리해 주세요."); return@runOnUiThread }
                    exportContent = content
                    val filename = objectData.optString("filename").takeIf { it.matches(Regex("[a-zA-Z0-9._-]+\\.(json|gpx)")) } ?: "sangil-ttara-records.json"
                    runCatching { startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = if (filename.endsWith(".gpx")) "application/gpx+xml" else "application/json"; putExtra(Intent.EXTRA_TITLE, filename)
                    }, 202) }.onFailure { exportContent = null; error("파일 저장 창을 열 수 없습니다.") }
                }
            }
        } }
    }
    private fun requestLocation(action: String) {
        pendingAction = action
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 101)
        } else launchLocation(action)
    }
    private fun launchLocation(action: String) {
        val config = JSONObject(pendingConfig)
        if (action == "start" && Build.VERSION.SDK_INT >= 33 && config.optBoolean("alertsEnabled") && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingAction = action
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 102)
            return
        }
        startLocationService(action)
    }
    private fun startLocationService(action: String) {
        if (action == "start") {
            if (JSONObject(pendingConfig).optBoolean("resume")) flushLocations()
            else File(filesDir, "gps-points.jsonl").writeText("")
        }
        runCatching { startForegroundService(Intent(this, TrailLocationService::class.java).putExtra("mode", action).putExtra("config", pendingConfig)) }.onFailure { error("GPS 서비스를 시작할 수 없습니다. 위치 권한을 확인해 주세요.") }
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if(code==101) {
            if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) launchLocation(pendingAction)
            else error("정확한 위치 권한이 필요합니다. 권한 없이 산 탐색은 계속 이용할 수 있습니다.")
        }
        if(code==102) {
            if (results.firstOrNull() != PackageManager.PERMISSION_GRANTED) error("알림 권한이 없어 기기 이탈 알림이 표시되지 않을 수 있습니다. GPS 기록은 계속합니다.")
            startLocationService(pendingAction)
        }
    }
    private fun savedLocations(): List<String> {
        val file = File(filesDir,"gps-points.jsonl")
        if (!file.exists()) return emptyList()
        return file.useLines { lines -> lines.mapNotNull { runCatching { JSONObject(it).toString() }.getOrNull() }.toList() }
    }
    private fun flushLocations() {
        if (!ready) return
        val points = runCatching { savedLocations() }.getOrElse { error("기기에 남은 GPS 기록을 읽지 못했습니다."); return }
        if (points.isNotEmpty()) web.evaluateJavascript("window.onTrailLocations?.([${points.joinToString(",")}])",null)
    }
    private fun error(message: String) { if(ready) web.evaluateJavascript("window.onTrailError?.(${JSONObject.quote(message)})",null) }
    override fun onResume() {
        super.onResume()
        val filter = IntentFilter("kr.seoultrail.LOCATION")
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, filter)
        flushLocations()
    }
    override fun onPause() { unregisterReceiver(receiver); super.onPause() }
    @Deprecated("Platform callback") override fun onActivityResult(requestCode: Int,resultCode: Int,data: Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode==201) {
            val uris = if(resultCode==RESULT_OK) data?.clipData?.let { clip -> Array(clip.itemCount) { clip.getItemAt(it).uri } } ?: data?.data?.let { arrayOf(it) } else null
            fileCallback?.onReceiveValue(uris);fileCallback=null
        }
        if(requestCode==202) {
            val content = exportContent; exportContent = null
            if (resultCode == RESULT_OK && content != null && data?.data != null) {
                val uri = data.data!!
                Thread {
                    runCatching {
                        val stream = contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("No output stream")
                        stream.bufferedWriter(Charsets.UTF_8).use { it.write(content) }
                    }.onSuccess { runOnUiThread { web.evaluateJavascript("window.onTrailExport?.(true)", null) } }
                     .onFailure { runOnUiThread { error("파일을 저장하지 못했습니다. 저장 공간과 선택한 폴더를 확인해 주세요.") } }
                }.start()
            }
        }
    }
    override fun onDestroy() { serverAPI.close(); fileCallback?.onReceiveValue(null); web.removeJavascriptInterface("AndroidTrail"); web.destroy(); super.onDestroy() }
}
