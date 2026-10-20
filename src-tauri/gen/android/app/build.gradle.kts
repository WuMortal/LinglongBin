import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    namespace = "com.linglong.bin"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.linglong.bin"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // 发布签名：密钥不入库，全部从环境变量 / ~/.gradle/gradle.properties 读
    // LLB_KEYSTORE_PATH / LLB_KEYSTORE_PASSWORD / LLB_KEY_ALIAS / LLB_KEY_PASSWORD
    // 四个变量没配齐时保持未签名（只能本地自测，真机安装会报「安装包没有签名文件」）
    signingConfigs {
        create("release") {
            val gradleProp = { k: String -> project.findProperty(k) as String? }
            val ksPath = System.getenv("LLB_KEYSTORE_PATH") ?: gradleProp("LLB_KEYSTORE_PATH")
            val ksPwd = System.getenv("LLB_KEYSTORE_PASSWORD") ?: gradleProp("LLB_KEYSTORE_PASSWORD")
            val alias = System.getenv("LLB_KEY_ALIAS") ?: gradleProp("LLB_KEY_ALIAS")
            val keyPwd = System.getenv("LLB_KEY_PASSWORD") ?: gradleProp("LLB_KEY_PASSWORD")
            if (ksPath != null && ksPwd != null && alias != null && keyPwd != null) {
                storeFile = file(ksPath)
                storePassword = ksPwd
                keyAlias = alias
                keyPassword = keyPwd
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
            // 配齐签名变量才挂上去，否则 release 构建会因 storeFile 为空直接失败
            if (signingConfigs.getByName("release").storeFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
