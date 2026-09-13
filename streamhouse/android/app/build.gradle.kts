plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps every build with its run number, which is what the app compares
// against to know it is out of date. A local build stays at 1 and never looks
// newer than whatever is installed from a release.
val buildVersionCode = (System.getenv("SH_VERSION_CODE") ?: "1").toIntOrNull() ?: 1
val buildVersionName = System.getenv("SH_VERSION_NAME") ?: "local build"

android {
    namespace = "com.streamhouse.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.streamhouse.tv"
        minSdk = 21          // Android TV 5.0 and up
        targetSdk = 34
        versionCode = buildVersionCode
        versionName = buildVersionName
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signed with the debug key so a plain `assembleRelease` produces an
            // APK that installs. Replace with your own keystore to publish.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // The player hands its result back to the WebView, which is what starts
    // the next episode.
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")
}
