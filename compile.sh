mkdir -p build/shader

glslc src/shader/ray_intersection.comp -o build/shader/ray_intersection.comp.spv
glslc src/shader/screen_ray_generation.comp -o build/shader/screen_ray_generation.comp.spv
glslc src/shader/ray_closest_hit.comp -o build/shader/ray_closest_hit.comp.spv