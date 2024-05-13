mkdir build\shader

glslc src/shader/ray_gen.comp -o build/shader/ray_gen.comp.spv
glslc src/shader/sampling.comp -o build/shader/sampling.comp.spv