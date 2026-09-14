cmake_minimum_required(VERSION 3.22.1)
project(streamhouse_node CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# NODE_MOBILE_DIR is passed in by app/build.gradle.kts, which downloads the
# nodejs-mobile release: bin/<abi>/libnode.so and include/node.
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${NODE_MOBILE_DIR}/bin/${ANDROID_ABI}/libnode.so)

add_library(native-lib SHARED native-lib.cpp)
target_include_directories(native-lib PRIVATE ${NODE_MOBILE_DIR}/include/node)

find_library(log-lib log)
target_link_libraries(native-lib node ${log-lib})
