add_executable(App	
    src/device/device.cpp
    src/render/basic/basic_render_system.cpp
    src/render/renderer.cpp
    src/apps/app.cpp
    main.cpp
)

cmake_minimum_required(VERSION 3.0...3.25)
project(
    LearnWebGPU # name of the project, which will also be the name of the visual studio solution if you use it
    VERSION 0.1.0 # any version number
    LANGUAGES CXX C # programming languages used by the project
)

set_target_properties(App PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
    COMPILE_WARNING_AS_ERROR ON
)

if (MSVC)
    target_compile_options(App PRIVATE /W4)
else()
    target_compile_options(App PRIVATE -Wall -Wextra -pedantic)
endif()

if (XCODE)
    set_target_properties(App PROPERTIES
        XCODE_GENERATE_SCHEME ON
        XCODE_SCHEME_ENABLE_GPU_FRAME_CAPTURE_MODE "Metal"
    )
endif()

if (NOT EMSCRIPTEN)
    add_subdirectory(lib/glfw)
else()
    # Emscripten has built-in support for GLFW but requires the `-sUSE_GLFW=3` link option:
    add_library(lib/glfw INTERFACE)
    target_link_options(glfw INTERFACE -sUSE_GLFW=3)
endif()

# Include webgpu directory, to define the 'webgpu' target
add_subdirectory(lib/webgpu)
add_subdirectory(lib/glfw3webgpu)

# The application's binary must find wgpu.dll or libwgpu.so at runtime,
# so we automatically copy it (it's called WGPU_RUNTIME_LIB in general)
# next to the binary.
target_link_libraries(App PRIVATE glfw webgpu glfw3webgpu)
target_copy_webgpu_binaries(App)