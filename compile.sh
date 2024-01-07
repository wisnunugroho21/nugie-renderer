mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/raygen.comp -o build/shader/raygen.comp.spv
glslc src/shader/quad.vert -o build/shader/quad.vert.spv
glslc src/shader/final.frag -o build/shader/final.frag.spv
