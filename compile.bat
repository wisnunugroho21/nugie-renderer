mkdir build\shader
mkdir build\shader\raster

glslc src/shader/path_tracing/indirect_ray_gen.comp -o build/shader/indirect_ray_gen.comp.spv
glslc src/shader/path_tracing/ray_intersect.comp -o build/shader/ray_intersect.comp.spv
glslc src/shader/path_tracing/indirect_ray_hit.comp -o build/shader/indirect_ray_hit.comp.spv
glslc src/shader/path_tracing/light_ray_hit.comp -o build/shader/light_ray_hit.comp.spv
glslc src/shader/path_tracing/ray_miss.comp -o build/shader/ray_miss.comp.spv
glslc src/shader/path_tracing/direct_ray_gen.comp -o build/shader/direct_ray_gen.comp.spv
glslc src/shader/path_tracing/direct_ray_hit.comp -o build/shader/direct_ray_hit.comp.spv
glslc src/shader/path_tracing/integrator.comp -o build/shader/integrator.comp.spv
glslc src/shader/path_tracing/sampling.comp -o build/shader/sampling.comp.spv

glslc src/shader/path_tracing/raster/final.vert -o build/shader/raster/final.vert.spv
glslc src/shader/path_tracing/raster/final.frag -o build/shader/raster/final.frag.spv

glslc src/shader/mesh_shader/better_cube.mesh -o build/shader/better_cube.mesh.spv --target-spv=spv1.4
glslc src/shader/mesh_shader/simple.task -o build/shader/simple.task.spv --target-spv=spv1.4
glslc src/shader/mesh_shader/mesh_shade.frag -o build/shader/mesh_shade.frag.spv --target-spv=spv1.4

