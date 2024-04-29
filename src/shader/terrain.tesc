#version 460

layout(vertices = 4) out;

layout(location = 0) in vec2 inTextCoord[];

layout(location = 0) out vec2 outTextCoord[];

layout(set = 0, binding = 0) uniform readonly CameraTransformationBuffer {
	mat4 view;
	mat4 projection;
};

layout(set = 0, binding = 1) uniform readonly TessellationData {
	vec4 tessellationScreenSizeFactorEdgeSize;
};

float screenSpaceTessFactor(vec4 p0, vec4 p1) {
	vec4 midPoint = 0.5 * (p0 + p1);
	float radius = distance(p0, p1) / 2.0;

	vec4 v0 = view * midPoint;

	vec4 clip0 = (projection * (v0 - vec4(radius, vec3(0.0))));
	vec4 clip1 = (projection * (v0 + vec4(radius, vec3(0.0))));

	clip0 /= clip0.w;
	clip1 /= clip1.w;

	clip0.xy *= tessellationScreenSizeFactorEdgeSize.xy;
	clip1.xy *= tessellationScreenSizeFactorEdgeSize.xy;
	
	return clamp(distance(clip0, clip1) / tessellationScreenSizeFactorEdgeSize.z * tessellationScreenSizeFactorEdgeSize.w, 1.0, 64.0);
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