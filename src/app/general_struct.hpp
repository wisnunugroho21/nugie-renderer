#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugieApp {
  struct Position {
    glm::vec4 position;

    bool operator == (const Position &other) const {
			return this->position == other.position;
		}
  };

  struct Normal {
    glm::vec4 normal;
  };

  struct TextCoord {
    glm::vec2 textCoord;
  };

  struct Reference {
    uint32_t materialIndex;
    uint32_t transformIndex;
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

  struct VolumeTileAABB{
    glm::vec4 minPoint;
    glm::vec4 maxPoint;
  };

  struct DeferredUbo {
    glm::vec4 origin;
    glm::uvec4 numLights;
  };

  struct ForwardUbo {
    glm::mat4 cameraTransforms;
  };

  struct ClusterBuildUbo {
    glm::mat4 inverseProjection;
    glm::uvec4 tileSizes;
    glm::uvec2 screenDimensions;
    float zNear;
    float zFar;
  };

  struct ShadowPushConstant {
    uint32_t lightIndex;
  };
}