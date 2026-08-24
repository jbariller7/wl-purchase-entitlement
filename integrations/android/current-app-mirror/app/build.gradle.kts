import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(keystorePropertiesFile.inputStream())
}

val localPropertiesFile = rootProject.file("local.properties")
val localProperties = Properties()
if (localPropertiesFile.exists()) {
    localProperties.load(localPropertiesFile.inputStream())
}

val wonderLangEntitlementsFirebaseApiKey =
    providers.environmentVariable("WONDERLANG_ENTITLEMENTS_FIREBASE_API_KEY").orNull
        ?: localProperties.getProperty("WONDERLANG_ENTITLEMENTS_FIREBASE_API_KEY")
        ?: throw GradleException(
            "Missing WONDERLANG_ENTITLEMENTS_FIREBASE_API_KEY. Set it in the build environment " +
                "or the untracked local.properties file. Never commit Firebase API keys."
        )

android {
    buildFeatures {
        resValues = true
    }

    /*
     * Keep the namespace as com.wonderlang.app so your existing Kotlin files,
     * imports, R references, and package declarations do not need to change.
     *
     * The Google Play package name is applicationId below.
     * For the new app, applicationId MUST be new and different from the suspended app.
     */
    namespace = "com.wonderlang.app"
    compileSdk = 36

    defaultConfig {
        // New Google Play package name for the app.
        applicationId = "com.wonderlang.app"

        minSdk = 24
        targetSdk = 36

        // New app/package, so versionCode can start again at 1.
        versionCode = 33
        versionName = "1.0.33 "

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        resValue(
            "string",
            "wonderlang_entitlements_api_key",
            wonderLangEntitlementsFirebaseApiKey
        )
    }

    signingConfigs {
        create("release") {
            if (!keystorePropertiesFile.exists()) {
                throw GradleException(
                    "Missing keystore.properties. Create it at the project root with storeFile, storePassword, keyAlias, keyPassword."
                )
            }

            val storeFilePath = keystoreProperties.getProperty("storeFile")
                ?: throw GradleException("keystore.properties missing 'storeFile'.")
            val storePasswordValue = keystoreProperties.getProperty("storePassword")
                ?: throw GradleException("keystore.properties missing 'storePassword'.")
            val keyAliasValue = keystoreProperties.getProperty("keyAlias")
                ?: throw GradleException("keystore.properties missing 'keyAlias'.")
            val keyPasswordValue = keystoreProperties.getProperty("keyPassword")
                ?: throw GradleException("keystore.properties missing 'keyPassword'.")

            storeFile = rootProject.file(storeFilePath)
            storePassword = storePasswordValue
            keyAlias = keyAliasValue
            keyPassword = keyPasswordValue
        }
    }

    buildTypes {
        release {
            // Disabled minification to prevent R8 from deleting your Javascript bridge.
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }

    // Leave RPG Maker assets uncompressed.
    androidResources {
        noCompress.addAll(listOf(
            ".png", ".jpg", ".jpeg",
            ".ogg", ".m4a", ".webm",
            ".json", ".html", ".js", ".css", ".txt",
            ".rpgmvp", ".rpgmvo", ".rpgmvw"
        ))
    }

    // French-only review-safe build.
    // Only the install-time game asset pack remains.
    // No optional/on-demand language asset packs are included.
    assetPacks += listOf(
        ":assetpack_game",
        ":assetpack_fr",
        ":assetpack_es",
        ":assetpack_de",
        ":assetpack_pt",
        ":assetpack_it",
        ":assetpack_kr",
        ":assetpack_jp",
        ":assetpack_zh",
        ":assetpack_en",
        ":assetpack_us",
        ":assetpack_ar"
    )


    // Enable bundle optimizations.
    bundle {
        language {
            enableSplit = true
        }
        density {
            enableSplit = true
        }
        abi {
            enableSplit = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.webkit)

    // Firebase Analytics automatically records app installs as first_open.
    // Link this Firebase Android app to Google Play in the Firebase console so
    // verified Play Billing transactions are reported as in_app_purchase.
    implementation(platform("com.google.firebase:firebase-bom:34.15.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-crashlytics")
    implementation("com.google.firebase:firebase-auth")

    // Passwordless cross-platform account sign-in. Google uses Android Credential
    // Manager; Apple uses Firebase's OAuth Custom Tab; email uses Firebase Hosting links.
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")

    // Meta App Events for Android install attribution and Play-confirmed purchases.
    implementation("com.facebook.android:facebook-core:18.3.0")

    // Google Play's native in-app rating and review card.
    implementation("com.google.android.play:review:2.0.2")
    implementation("com.google.android.play:review-ktx:2.0.2")

    // Play Asset Delivery is still needed because the game content is in the install-time game pack.
    implementation("com.google.android.play:asset-delivery:2.3.0")
    implementation("com.google.android.play:asset-delivery-ktx:2.3.0")

    // Google Play Billing Library.
    implementation("com.android.billingclient:billing:9.1.0")

    // AndroidX WebKit for WebViewAssetLoader.
    implementation("androidx.webkit:webkit:1.10.0")

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
