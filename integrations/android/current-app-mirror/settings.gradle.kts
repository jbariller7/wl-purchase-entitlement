pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "wonderlang"
include(":app")
// include(":assetpack_core")  // ❌ Disabled - core assets moved to base APK
include(":assetpack_game")
include(":assetpack_fr")
include(":assetpack_es")
include(":assetpack_de")
include(":assetpack_pt")
include(":assetpack_it")
include(":assetpack_kr")
include(":assetpack_jp")
include(":assetpack_zh")
include(":assetpack_en")
include(":assetpack_us")
include(":assetpack_ar")
