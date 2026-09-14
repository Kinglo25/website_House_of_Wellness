import java.net.URI
import java.util.zip.ZipInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app runs StreamHouse itself: the same Node.js server a computer runs,
// on Node.js for Android from https://github.com/nodejs-mobile/nodejs-mobile.
val nodeMobileVersion = "18.20.4"
val nodeMobileDir: File = layout.buildDirectory.dir("nodejs-mobile/$nodeMobileVersion").get().asFile
val streamhouseDir: File = rootDir.parentFile

android {
    namespace = "com.streamhouse.tv"
    compileSdk = 34
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "com.streamhouse.tv"
        minSdk = 24          // nodejs-mobile's Node needs Android 7.0
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"

        externalNativeBuild {
            cmake {
                // libnode.so is built against the shared C++ runtime, so the app ships it too.
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DNODE_MOBILE_DIR=${nodeMobileDir.invariantSeparatorsPath}"
                )
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signed with the debug key so a plain `assembleRelease` produces an
            // APK that installs. Replace with your own keystore to publish.
            signingConfig = signingConfigs.getByName("debug")
            // Android TVs and phones are ARM; each ABI adds about 18 MB.
            ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
        }
        debug {
            // Plus x86_64, for the emulator.
            ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86_64") }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    sourceSets["main"].jniLibs.srcDir(File(nodeMobileDir, "bin"))

    packaging {
        // Extracted to disk, libnode.so loads the same way on every Android version.
        jniLibs.useLegacyPackaging = true
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

/* ------------------------------------------------------- Node.js for Android */

val fetchNodeMobile by tasks.registering {
    description = "Downloads Node.js for Android: libnode.so for each ABI, and its headers."
    doLast {
        val wanted = listOf("include/node/node.h") +
            listOf("arm64-v8a", "armeabi-v7a", "x86_64").map { "bin/$it/libnode.so" }
        if (wanted.all { File(nodeMobileDir, it).isFile }) return@doLast

        // Unpacked beside the real folder and moved into place at the end, so
        // an interrupted download is never mistaken for a finished one.
        val partial = File(nodeMobileDir.parentFile, "${nodeMobileDir.name}.partial")
        partial.deleteRecursively()
        val url = "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/" +
            "v$nodeMobileVersion/nodejs-mobile-v$nodeMobileVersion-android.zip"
        ZipInputStream(URI(url).toURL().openStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val file = File(partial, entry.name)
                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile.mkdirs()
                    file.outputStream().use { zip.copyTo(it) }
                }
            }
        }
        nodeMobileDir.deleteRecursively()
        check(partial.renameTo(nodeMobileDir)) { "Could not move nodejs-mobile into $nodeMobileDir" }
    }
}

tasks.named("preBuild") { dependsOn(fetchNodeMobile) }
tasks.configureEach {
    if (name.startsWith("configureCMake") || name.startsWith("buildCMake")) dependsOn(fetchNodeMobile)
}

/* ------------------------------------------------------- the StreamHouse server */

val packNodeProject by tasks.registering(Zip::class) {
    description = "Packs the StreamHouse server, web app and node_modules into the app's assets."
    val modules = File(streamhouseDir, "node_modules")
    doFirst {
        check(File(modules, "express").isDirectory) {
            "Run `npm ci --omit=dev` in streamhouse/ first: the app ships the server's node_modules."
        }
    }
    archiveFileName.set("nodejs-project.zip")
    destinationDirectory.set(layout.buildDirectory.dir("nodejs-project"))

    from(streamhouseDir) { include("package.json") }
    from(File(streamhouseDir, "server")) { into("server") }
    from(File(streamhouseDir, "public")) { into("public") }
    from(modules) {
        into("node_modules")
        // Native add-ons built for desktops cannot load on Android, and their
        // callers manage without: WebTorrent drops uTP, ws falls back to plain
        // JavaScript, and WebRTC is switched off by the stand-in below.
        exclude("node-datachannel/**", "utp-native/**", "bufferutil/**", "utf-8-validate/**", "webrtc-polyfill/**")
        exclude("**/prebuilds/**", "**/*.node")
        // Nor does a phone need documentation, type definitions, source maps
        // or WebTorrent's browser bundle.
        exclude("**/*.md", "**/*.d.ts", "**/*.map", "webtorrent/dist/**")
    }
    from("src/node/webrtc-polyfill") { into("node_modules/webrtc-polyfill") }
}

// The Android plugin adds generated assets through a task with an output
// directory. A Zip task's output is its archive, not its folder, so handing the
// folder over would leave the plugin unaware it has to pack first — this task
// takes the archive as its input, which it does know how to wait for.
abstract class NodeProjectAssets : DefaultTask() {
    @get:InputFiles
    abstract val archive: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDirectory.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        archive.files.forEach { it.copyTo(File(out, it.name), overwrite = true) }
    }
}

val nodeProjectAssets by tasks.registering(NodeProjectAssets::class) {
    archive.from(packNodeProject)
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(nodeProjectAssets, NodeProjectAssets::outputDirectory)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")
}
