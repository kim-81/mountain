package kr.seoultrail.app

import android.location.Location
import org.json.JSONObject
import kotlin.math.*

// 웹뷰가 정지된 동안에도 위치 서비스가 동일한 기준으로 이탈 여부를 판정합니다.
class DeviationTracker(config: JSONObject) {
    private val enabled = config.optBoolean("alertsEnabled")
    private val segments = config.optJSONArray("routeSegments")
    private var outsideCount = 0
    private var lastAlertAt = 0L
    private var lastFixAt = 0L
    fun shouldAlert(fix: Location): Boolean {
        if (!enabled || fix.accuracy < 0 || fix.accuracy > 80) { outsideCount = 0; return false }
        if (fix.time <= lastFixAt) return false
        lastFixAt = fix.time
        var nearest = Double.POSITIVE_INFINITY
        val scale = Math.PI / 180 * 6371000
        val cosLat = cos(fix.latitude * Math.PI / 180)
        if (segments != null) for (i in 0 until segments.length()) {
            val segment = segments.optJSONArray(i) ?: continue
            for (j in 1 until segment.length()) {
                val a = segment.optJSONObject(j - 1) ?: continue
                val b = segment.optJSONObject(j) ?: continue
                val ax = (a.optDouble("lng") - fix.longitude) * cosLat * scale
                val ay = (a.optDouble("lat") - fix.latitude) * scale
                val bx = (b.optDouble("lng") - fix.longitude) * cosLat * scale
                val by = (b.optDouble("lat") - fix.latitude) * scale
                val dx = bx - ax; val dy = by - ay
                val length = dx * dx + dy * dy
                val t = if (length > 0) (-(ax * dx + ay * dy) / length).coerceIn(0.0, 1.0) else 0.0
                nearest = min(nearest, hypot(ax + t * dx, ay + t * dy))
            }
        }
        if (!nearest.isFinite()) return false
        if (nearest > max(70.0, fix.accuracy * 2.0)) outsideCount++ else outsideCount = 0
        if (outsideCount >= 3 && fix.time - lastAlertAt >= 90000) {
            lastAlertAt = fix.time
            return true
        }
        return false
    }
}
