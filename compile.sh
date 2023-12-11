mkdir -p build/shader

glslc src/shader/forward.frag -o build/shader/forward.frag.spv
glslc src/shader/forward.vert -o build/shader/forward.vert.spv
glslc src/shader/deferred.frag -o build/shader/deferred.frag.spv
glslc src/shader/deferred.vert -o build/shader/deferred.vert.spv
glslc src/shader/point_shadow_map.geom -o build/shader/point_shadow_map.geom.spv
glslc src/shader/point_shadow_map.vert -o build/shader/point_shadow_map.vert.spv
glslc src/shader/spot_shadow_map.vert -o build/shader/spot_shadow_map.vert.spv

