#!/usr/bin/env bash
# 打一个可直接安装试用的 Android APK（arm64，release，用本机的试用签名）。
#
#   scripts/build-android.sh
#
# 需要：rustup（带 aarch64-linux-android 目标）、JDK 17、Android SDK（platforms;android-36、build-tools）和 NDK，
# 用 ANDROID_HOME / NDK_HOME / JAVA_HOME 指定。服务地址默认 https://api.outbriefapp.com，
# 用 VITE_OUTBRIEF_SERVER_URL=<地址> 换（手机连不到电脑上的 localhost）。
# 签名密钥第一次打包时生成在 ~/.outbrief-android/（release.jks 和随机密码 release.pass，都不在仓库里）；
# 之后一直用它签，手机上的 App 才能覆盖升级。
# src-tauri/gen/ 不进仓库：没有就先 tauri android init，再补上相机 / 麦克风权限和 release 签名。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
die() {
    printf '[android] %s\n' "$*" >&2
    exit 1
}

for v in ANDROID_HOME NDK_HOME JAVA_HOME; do
    [ -n "${!v:-}" ] || die "没有设置 ${v}"
done
command -v rustup >/dev/null 2>&1 || die "找不到 rustup（Homebrew 的 rust 没有 Android 目标）"
rustup target add aarch64-linux-android >/dev/null

GEN=src-tauri/gen/android
[ -d "$GEN" ] || pnpm tauri android init --ci

# 扫码加入账号（qr-scanner）和录音要相机 / 麦克风；WebView 申请时由 wry 弹系统授权
MANIFEST="$GEN/app/src/main/AndroidManifest.xml"
if ! grep -q 'android.permission.CAMERA' "$MANIFEST"; then
    perl -0pi -e 's|(<uses-permission android:name="android.permission.INTERNET" />)|$1\n    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />|' "$MANIFEST"
fi

# 大模型 / 语音接口地址由用户填，可能是局域网里的 http://
GRADLE="$GEN/app/build.gradle.kts"
perl -pi -e 's|manifestPlaceholders\["usesCleartextTraffic"\] = "false"|manifestPlaceholders["usesCleartextTraffic"] = "true"|' "$GRADLE"

KEY_DIR="$HOME/.outbrief-android"
KEYSTORE="$KEY_DIR/release.jks"
if [ ! -f "$KEYSTORE" ]; then
    mkdir -p "$KEY_DIR"
    (umask 077 && openssl rand -hex 24 >"$KEY_DIR/release.pass")
    KEY_PASS=$(cat "$KEY_DIR/release.pass")
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEYSTORE" -alias outbrief -keyalg RSA -keysize 2048 \
        -validity 10000 -storepass "$KEY_PASS" -keypass "$KEY_PASS" -dname "CN=OutBrief Local" >/dev/null
fi
KEY_PASS=$(cat "$KEY_DIR/release.pass")
cat >"$GEN/keystore.properties" <<EOF
storeFile=$KEYSTORE
storePassword=$KEY_PASS
keyAlias=outbrief
keyPassword=$KEY_PASS
EOF
if ! grep -q 'signingConfigs' "$GRADLE"; then
    perl -0pi -e 's|^import java.util.Properties|import java.io.FileInputStream\nimport java.util.Properties|m;
s|(\n    buildTypes \{)|\n    signingConfigs {\n        create("release") {\n            val keystoreProperties = Properties().apply {\n                load(FileInputStream(rootProject.file("keystore.properties")))\n            }\n            keyAlias = keystoreProperties["keyAlias"] as String\n            keyPassword = keystoreProperties["keyPassword"] as String\n            storeFile = file(keystoreProperties["storeFile"] as String)\n            storePassword = keystoreProperties["storePassword"] as String\n        }\n    }$1|;
s|(getByName\("release"\) \{)|$1\n            signingConfig = signingConfigs.getByName("release")|' "$GRADLE"
fi

VITE_OUTBRIEF_SERVER_URL=${VITE_OUTBRIEF_SERVER_URL:-https://api.outbriefapp.com} \
    pnpm tauri android build --apk --target aarch64
APK="$GEN/app/build/outputs/apk/universal/release/app-universal-release.apk"
mkdir -p dist-android
cp "$APK" dist-android/OutBrief.apk
printf '[android] %s\n' "APK：dist-android/OutBrief.apk"
