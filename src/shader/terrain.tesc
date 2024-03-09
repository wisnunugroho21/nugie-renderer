#version 460

layout(vertices = 4) out;

layout(location = 0) in vec2 inTextCoord[];

layout(location = 0) out vec2 outTextCoord[];

layout(set = 0, binding = 0) uniform readonly CameraTransformation {
	mat4 view;
	mat4 projection;
};

layout(set = 0, binding = 1) uniform readonly TessellationData {
	vec2 screenSize;
};

// Calculate the tessellation factor based on screen space
// dimensions of the edge
float screenSpaceTessFactor(vec4 p0, vec4 p1)
{
	// Calculate edge mid point
	vec4 midPoint = 0.5 * (p0 + p1);
	// Sphere radius as distance between the control points
	float radius = distance(p0, p1) / 2.0;

	// View space
	vec4 v0 = view * midPoint;

	// Project into clip space
	vec4 clip0 = (projection * (v0 - vec4(radius, vec3(0.0))));
	vec4 clip1 = (projection * (v0 + vec4(radius, vec3(0.0))));

	// Get normalized device coordinates
	clip0 /= clip0.w;
	clip1 /= clip1.w;

	// Convert to viewport coordinates
	clip0.xy *= screenSize;
	clip1.xy *= screenSize;
	
	// Return the tessellation factor based on the screen size 
	// given by the distance of the two edge control points in screen space
	// and a reference (min.) tessellation size for the edge set by the application
	return clamp(distance(clip0, clip1) / 32 * 1.0f, 1.0, 32.0);
}

void main() {
  gl_out[gl_InvocationID].gl_Position = gl_in[gl_InvocationID].gl_Position;
  outTextCoord[gl_InvocationID] = inTextCoord[gl_InvocationID];

  if (gl_InvocationID == 0) {
		gl_TessLevelOuter[0] = screenSpaceTessFactor(gl_in[3].gl_Position, gl_in[0].gl_Position);
		gl_TessLevelOuter[1] = screenSpaceTessFactor(gl_in[0].gl_Position, gl_in[1].gl_Position);
		gl_TessLevelOuter[2] = screenSpaceTessFactor(gl_in[1].gl_Position, gl_in[2].gl_Position);
		gl_TessLevelOuter[3] = screenSpaceTessFactor(gl_in[2].gl_Position, gl_in[3].gl_Position);

		gl_TessLevelInner[0] = mix(gl_TessLevelOuter[0], gl_TessLevelOuter[3], 0.5);
		gl_TessLevelInner[1] = mix(gl_TessLevelOuter[2], gl_TessLevelOuter[1], 0.5);
  }
}