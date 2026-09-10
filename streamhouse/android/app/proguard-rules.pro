# The web UI calls into this class by name through the JavaScript bridge.
-keepclassmembers class com.streamhouse.tv.WebBridge {
   public *;
}
-keepattributes JavascriptInterface
