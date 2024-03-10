#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugieApp {
  struct Vertex {
    glm::vec4 position;

    bool operator == (const Vertex &other) const {
			return this->position == other.position;
		}
  };

  struct NormText {    
    glm::vec4 normal;
    glm::vec2 textCoord;
  };  
  
  struct Reference {
    uint32_t materialIndex;
    uint32_t transformIndex;
  };

  struct Patch {
    glm::vec4 position;
    alignas(16) glm::vec2 textCoord;
  };

  struct Material {
    alignas(16) glm::vec4 baseColor;
    alignas(16) glm::vec4 params;
    uint32_t colorTextureIndex;
  };

  struct Transformation {
    glm::mat4 modelMatrix{1.0f};
    glm::mat4 normalMatrix{1.0f};
  };

  struct ShadowTransformation {
    glm::mat4 viewProjectionMatrix{1.0f};
  };

  struct PointLight {
    glm::vec4 position;
    glm::vec4 color;
  };

  struct SpotLight {
    alignas(16) glm::vec4 position;
    alignas(16) glm::vec4 color;
    alignas(16) glm::vec4 direction;
    float angle;
  };

  struct SunLight {
    alignas(16) glm::vec4 color;
    alignas(16) glm::vec4 direction;
  };

  struct FragmentData {
    glm::vec4 origin;
    glm::uvec4 numLights;
    SunLight sunLight;
  };

  struct CameraTransformation {
    glm::mat4 view;
	  glm::mat4 projection;
  };

  struct TessellationData {
    alignas(16) glm::vec2 screenSize;
    float tessellationFactor;
	  float tessellatedEdgeSize;
  };

  struct FrustumData {
    alignas(16) glm::vec4 frustumPlanes[6];
    uint32_t drawObjectCount;
  };

  struct ShadowPushConstant {
    uint32_t lightIndex;
  };
}