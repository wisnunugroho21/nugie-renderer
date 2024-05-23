#version 460

#include "core/struct.glsl"

layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in uint materialIndex;
layout(location = 3) in uint transformIndex;

layout(location = 0) out vec4 fragPosition;
layout(location = 1) out vec4 fragNormal;
layout(location = 2) out flat uint fragMaterialIndex;

layout(set = 0, binding = 0) uniform readonly CameraTransformationBuffer {
	mat4 view;
	mat4 projection;
};

layout(set = 0, binding = 1) buffer readonly TransformationBuffer {
  Transformation transformations[];
};

void main() {
	fragPosition = transformations[transformIndex].pointMatrix * vec4(position, 1.0f);
	gl_Position = (projection * view) * fragPosition;
	
	fragNormal = normalize(transformations[transformIndex].normalMatrix * vec4(normal, 1.0f));
	fragMaterialIndex = materialIndex;
}