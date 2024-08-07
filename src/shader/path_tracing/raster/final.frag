#version 450

layout(location = 0) in vec2 fragTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0) uniform sampler2D resultTexture;

void main() {
    outColor = texture(resultTexture, fragTextCoord);
}