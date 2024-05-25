#version 460

#include "core/struct.glsl"

layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in uint materialIndex;
layout(location = 3) in uint transformIndex;

layout(location = 0) out precise vec4 fragPosition;
layout(location = 1) out vec4 fragNormal;
layout(location = 2) out flat uint fragMaterialIndex;

layout(set = 0, binding = 0) uniform readonly CameraTransformationBuffer {
	mat4 cameraTransf;
};

layout(set = 0, binding = 1) buffer readonly TransformationBuffer {
  Transformation transformations[];
};

void main() {
	mat4 transfMatrix = transformations[transformIndex].pointMatrix;

	fragPosition.x = transfMatrix[3][0] +
		fma( 
			transfMatrix[0][0], 
			position.x,
			fma( 
				transfMatrix[1][0], 
				position.y,
				( transfMatrix[2][0] * position.z ) 
			) 
		);

	fragPosition.y = transfMatrix[3][1] +
		fma( 
			transfMatrix[0][1], 
			position.x,
			fma( 
				transfMatrix[1][1], 
				position.y,
				( transfMatrix[2][1] * position.z ) 
			) 
		);

	fragPosition.z = transfMatrix[3][2] +
		fma( 
			transfMatrix[0][2], 
			position.x,
			fma( 
				transfMatrix[1][2], 
				position.y,
				( transfMatrix[2][2] * position.z ) 
			) 
		);

	fragPosition.w = 1.0f;

	fragPosition = transformations[transformIndex].pointMatrix * vec4(position, 1.0f);
	gl_Position = cameraTransf * fragPosition;
	
	fragNormal = normalize(transformations[transformIndex].normalMatrix * vec4(normal, 1.0f));
	fragMaterialIndex = materialIndex;
}