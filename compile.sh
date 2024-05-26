mkdir -p build/shader

glslc src/shader/indirect_ray_gen.comp -o build/shader/indirect_ray_gen.comp.spv
glslc src/shader/ray_intersect.comp -o build/shader/ray_intersect.comp.spv
glslc src/shader/indirect_ray_hit.comp -o build/shader/indirect_ray_hit.comp.spv
glslc src/shader/light_ray_hit.comp -o build/shader/light_ray_hit.comp.spv
glslc src/shader/integrator.comp -o build/shader/integrator.comp.spv
glslc src/shader/sampling.comp -o build/shader/sampling.comp.spv