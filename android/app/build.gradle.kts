plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI passes -Pvc=<run number>; local builds stay at 1
val vc = (project.findProperty("vc") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "io.github.dontbass.router404"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.dontbass.router404"
        minSdk = 26
        targetSdk = 34
        versionCode = vc
        versionName = "1.0.$vc"
    }

    // The key lives in the repository so every CI build can update the
    // previous one in place. Replace it with your own (and GitHub secrets)
    // if the APK is ever shared outside your own phones.
    signingConfigs {
        create("release") {
            storeFile = file("../keystore/router404.jks")
            storePassword = "router404-widget"
            keyAlias = "router404"
            keyPassword = "router404-widget"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
