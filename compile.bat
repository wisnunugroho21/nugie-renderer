mkdir build\shader

glslc src/shader/sun_direct_shade.comp -o build/shader/sun_direct_shade.comp.spv
glslc src/shader/direct_shade.comp -o build/shader/direct_shade.comp.spv
glslc src/shader/sun_direct_sampler.comp -o build/shader/sun_direct_sampler.comp.spv
glslc src/shader/direct_sampler.comp -o build/shader/direct_sampler.comp.spv
glslc src/shader/indirect_sampler.comp -o build/shader/indirect_sampler.comp.spv
glslc src/shader/integrator.comp -o build/shader/integrator.comp.spv
glslc src/shader/miss.comp -o build/shader/miss.comp.spv
glslc src/shader/light_shade.comp -o build/shader/light_shade.comp.spv
glslc src/shader/indirect_shade.comp -o build/shader/indirect_shade.comp.spv
glslc src/shader/intersect_light.comp -o build/shader/intersect_light.comp.spv
glslc src/shader/intersect_object.comp -o build/shader/intersect_object.comp.spv
glslc src/shader/sampling.frag -o build/shader/sampling.frag.spv
glslc src/shader/sampling.vert -o build/shader/sampling.vert.spv