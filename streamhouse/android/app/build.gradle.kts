plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps every build with its run number, which is what the app compares
// against to know it is out of date. A local build stays at 1 and never looks
// newer than whatever is installed from a release.
fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

val buildVersionCode = (env("SH_VERSION_CODE") ?: "1").toIntOrNull() ?: 1
val buildVersionName = env("SH_VERSION_NAME") ?: "local build"

// Android installs an update only over an app signed with the same key. The
// debug key is generated per machine, so builds from different CI runs cannot
// replace each other — which is the whole point of updating in place. When the
// repository has a signing key, every build is signed with that one instead.
val releaseKeystore = env("SH_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

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

    signingConfigs {
        if (releaseKeystore != null) {
            create("streamhouse") {
                storeFile = releaseKeystore
                storePassword = env("SH_KEYSTORE_PASSWORD")
                keyAlias = env("SH_KEY_ALIAS") ?: "streamhouse"
                keyPassword = env("SH_KEY_PASSWORD") ?: env("SH_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // The debug key keeps a plain local `assembleRelease` installable;
            // a build with a real key behind it can be updated over.
            signingConfig = signingConfigs.findByName("streamhouse") ?: signingConfigs.getByName("debug")
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
