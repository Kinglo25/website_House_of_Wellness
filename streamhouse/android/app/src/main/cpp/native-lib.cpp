// Starts Node.js inside the app: the bridge between NodeEngine.kt and the
// libnode.so that nodejs-mobile builds for Android.

#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

namespace {

int output_pipe[2];

// Android discards stdout and stderr. Everything the server prints goes to
// logcat instead: `adb logcat -s StreamHouseNode`.
void *forward_output(void *) {
    char buffer[2048];
    ssize_t size;
    while ((size = read(output_pipe[0], buffer, sizeof buffer - 1)) > 0) {
        if (buffer[size - 1] == '\n') size--;
        buffer[size] = '\0';
        __android_log_write(ANDROID_LOG_INFO, "StreamHouseNode", buffer);
    }
    return nullptr;
}

void redirect_output() {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(output_pipe) != 0) return;
    dup2(output_pipe[1], STDOUT_FILENO);
    dup2(output_pipe[1], STDERR_FILENO);
    pthread_t thread;
    if (pthread_create(&thread, nullptr, forward_output, nullptr) == 0) pthread_detach(thread);
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_com_streamhouse_tv_NodeEngine_setEnv(JNIEnv *env, jobject, jstring name, jstring value) {
    const char *name_chars = env->GetStringUTFChars(name, nullptr);
    const char *value_chars = env->GetStringUTFChars(value, nullptr);
    setenv(name_chars, value_chars, 1);
    env->ReleaseStringUTFChars(name, name_chars);
    env->ReleaseStringUTFChars(value, value_chars);
}

// Runs Node with these arguments and returns its exit code — which, for a
// server, means it does not return while the app is alive.
extern "C" JNIEXPORT jint JNICALL
Java_com_streamhouse_tv_NodeEngine_startNode(JNIEnv *env, jobject, jobjectArray arguments) {
    const jsize argc = env->GetArrayLength(arguments);
    std::vector<std::string> copies;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto argument = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char *chars = env->GetStringUTFChars(argument, nullptr);
        copies.emplace_back(chars);
        env->ReleaseStringUTFChars(argument, chars);
        env->DeleteLocalRef(argument);
        total += copies.back().size() + 1;
    }

    // libuv rewrites the process title in place, so argv must be one
    // contiguous block of memory, as it is for a real process.
    char *block = static_cast<char *>(calloc(total, 1));
    std::vector<char *> argv(argc);
    char *cursor = block;
    for (jsize i = 0; i < argc; i++) {
        memcpy(cursor, copies[i].c_str(), copies[i].size() + 1);
        argv[i] = cursor;
        cursor += copies[i].size() + 1;
    }

    redirect_output();
    return static_cast<jint>(node::Start(argc, argv.data()));
}
