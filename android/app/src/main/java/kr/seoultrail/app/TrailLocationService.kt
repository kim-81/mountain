package kr.seoultrail.app

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.location.*
import android.os.*
import org.json.JSONObject
import java.io.File

class TrailLocationService : Service(), LocationListener {
    private lateinit var manager: LocationManager
    private var single = false
    private var deviation = DeviationTracker(JSONObject())
    override fun onBind(intent: Intent?) = null
    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(LOCATION_SERVICE) as LocationManager
        val notifications = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notifications.createNotificationChannel(NotificationChannel("trail", "산행 GPS 기록", NotificationManager.IMPORTANCE_LOW))
        notifications.createNotificationChannel(NotificationChannel("trail-alerts", "경로 이탈 확인", NotificationManager.IMPORTANCE_HIGH))
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 이미 기록 중이라면 주변 산 조회 요청으로 기록을 중단하지 않습니다.
        val mode = intent?.getStringExtra("mode") ?: "locate"
        if (mode == "start") single=false else if (!recording) single=true
        if(mode=="start") {
            recording=true
            deviation = DeviationTracker(runCatching { JSONObject(intent?.getStringExtra("config") ?: "{}") }.getOrDefault(JSONObject()))
        }
        val open = PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification=Notification.Builder(this,"trail").setContentTitle("산길따라 · GPS 위치 확인 중").setContentText("앱에서 산행을 종료하면 위치 기록이 멈춥니다.").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentIntent(open).setOngoing(true).build()
        startForeground(1,notification)
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){stopSelf();return START_NOT_STICKY}
        if(!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)){
            sendBroadcast(Intent("kr.seoultrail.LOCATION").setPackage(packageName).putExtra("error", "GPS가 꺼져 있습니다. 기기의 위치 설정을 켜 주세요."))
            stopSelf();return START_NOT_STICKY
        }
        manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,3000L,3f,this,Looper.getMainLooper())
        return START_NOT_STICKY
    }
    private var recording=false
    override fun onLocationChanged(location: Location) {
        val point=JSONObject().put("lat",location.latitude).put("lng",location.longitude).put("accuracy",location.accuracy.toDouble()).put("time",location.time)
        if (single && !recording) {
            sendBroadcast(Intent("kr.seoultrail.LOCATION").setPackage(packageName).putExtra("fix", point.toString()))
            stopSelf()
            return
        }
        File(filesDir,"gps-points.jsonl").appendText(point.toString()+"\n")
        if(recording && deviation.shouldAlert(location)) {
            val notification = Notification.Builder(this,"trail-alerts").setContentTitle("산길따라 · 경로 확인").setContentText("가져온 경로에서 벗어났을 수 있어요. 현재 위치와 주변을 확인해 주세요.").setSmallIcon(android.R.drawable.ic_dialog_alert).setAutoCancel(true).build()
            val allowed = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (allowed) (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(2,notification)
        }
        sendBroadcast(Intent("kr.seoultrail.LOCATION").setPackage(packageName))
    }
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
    @Deprecated("Platform callback") override fun onStatusChanged(provider: String?,status: Int,extras: Bundle?) {}
    override fun onDestroy() { manager.removeUpdates(this); recording=false; super.onDestroy() }
}
