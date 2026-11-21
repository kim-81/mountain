plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "kr.seoultrail.app"
    compileSdk = 35
    defaultConfig { applicationId = "kr.seoultrail.app"; minSdk = 26; targetSdk = 35; versionCode = 15; versionName = "0.8.7" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
// 제3자 UI·지도·분석 SDK 없이 Android 기본 API를 사용합니다.
