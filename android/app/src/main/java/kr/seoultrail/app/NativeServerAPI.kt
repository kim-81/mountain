package kr.seoultrail.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.os.SystemClock
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection

// 인증 토큰은 웹에 반환하지 않고 Keystore 키로 암호화해 기기에 보관합니다.
class NativeServerAPI(private val context: Context) {
    private val executor = Executors.newSingleThreadExecutor()
    private val deadlines = Executors.newSingleThreadScheduledExecutor()
    private val origin by lazy { JSONObject(context.assets.open("web/server-config.json").bufferedReader().use { it.readText() }).optString("apiOrigin") }
    private val preferences = context.getSharedPreferences("server-session", Context.MODE_PRIVATE)
    private fun storageKey(): String = MessageDigest.getInstance("SHA-256").digest(origin.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("sangil-server-session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("sangil-server-session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun token(): String? = runCatching {
        val stored = preferences.getString(storageKey(), null) ?: return null
        val parts = stored.split(':')
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8).takeIf { it.matches(Regex("[a-f0-9]{64}")) }
    }.getOrNull()
    private fun saveToken(value: String) {
        if (value == "clear") { check(preferences.edit().remove(storageKey()).commit()); return }
        require(value.matches(Regex("[a-f0-9]{64}")))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        val data = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        check(preferences.edit().putString(storageKey(), data).commit())
    }
    fun request(message: JSONObject, completed: (JSONObject) -> Unit) {
        val expires = SystemClock.elapsedRealtime() + 14000
        executor.execute {
            val result = JSONObject().put("requestId", message.optString("requestId"))
            var connection: HttpsURLConnection? = null
            var deadline: java.util.concurrent.ScheduledFuture<*>? = null
            try {
                require(SystemClock.elapsedRealtime() < expires)
                val path = message.optString("path"); val method = message.optString("method")
                require(path.matches(Regex("[a-z0-9/-]{1,200}")) && method in listOf("GET", "POST", "DELETE"))
                val publicURL = when (path) {
                    "public-notices/knps" -> "https://www.knps.or.kr/front/portal/safe/acsCtrList.do?menuNo=8000340"
                    "public-notices/seoultrail" -> "https://gil.seoul.go.kr/bbsctt/list.do?key=2304100032"
                    "public-notices/citywall" -> "https://seoulcitywall.seoul.go.kr/board/B0001.do?bcaId=0&pageIndex=1"
                    else -> null
                }
                if (publicURL != null) require(method == "GET") else {
                    val base = URL(origin)
                    require(base.protocol == "https" && base.userInfo == null && base.query == null && base.ref == null && base.path.isEmpty())
                }
                connection = URL(publicURL ?: "$origin/api/$path").openConnection() as HttpsURLConnection
                val currentConnection = connection
                deadline = deadlines.schedule({ currentConnection.disconnect() }, (expires - SystemClock.elapsedRealtime()).coerceAtLeast(1), TimeUnit.MILLISECONDS)
                connection.requestMethod = method; connection.instanceFollowRedirects = false
                connection.connectTimeout = 7000; connection.readTimeout = 7000
                connection.setRequestProperty("Accept", if (publicURL != null) "text/html" else "application/json")
                if (publicURL == null) {
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("X-Sangil-Request", "1"); connection.setRequestProperty("X-Sangil-Native", "1")
                    token()?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
                }
                if (method != "GET") {
                    val body = message.optJSONObject("body")?.toString() ?: "{}"
                    require(body.toByteArray(Charsets.UTF_8).size <= 3 * 1024 * 1024)
                    connection.doOutput = true
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                require(status !in 300..399) // 인증이 다른 주소로 전달되지 않도록 리디렉션 금지.
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val output = ByteArrayOutputStream()
                stream?.use { input ->
                    val buffer = ByteArray(8192)
                    while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size() + count <= (if (publicURL != null) 2 else 8) * 1024 * 1024); output.write(buffer, 0, count) }
                }
                val body = if (publicURL != null) JSONObject().put("html", output.toString("UTF-8")).put("fetchedAt", System.currentTimeMillis()) else JSONObject(output.toString("UTF-8"))
                if (publicURL == null) {
                    if (status in 200..299) connection.getHeaderField("X-Sangil-Token")?.let { saveToken(it) }
                    if (status == 401 && path !in listOf("auth/login", "auth/register")) saveToken("clear")
                }
                result.put("status", status).put("body", body)
            } catch (_: Exception) { result.put("error", "공유 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 저장 결과를 새로고침해 주세요.") }
            finally { deadline?.cancel(false); connection?.disconnect() }
            completed(result)
        }
    }
    fun close() { executor.shutdownNow(); deadlines.shutdownNow() }
}
