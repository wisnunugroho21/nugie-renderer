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

  struct Primitive {
    alignas(16) glm::uvec3 indices{0u};
    uint32_t materialIndex = 0u;
  };

  struct Object {
    uint32_t firstBvhIndex = 0u;
    uint32_t firstPrimitiveIndex = 0u;
    uint32_t transformIndex = 0u;
  };

  struct BvhNode {
    uint32_t leftNode = 0u;
    uint32_t rightNode = 0u;
    uint32_t objIndex = 0u;

    alignas(16) glm::vec3 maximum{0.0f};
    alignas(16) glm::vec3 minimum{0.0f};
  };

  struct Material {
    alignas(16) glm::vec4 baseColor;
    alignas(16) glm::vec4 params;
    uint32_t colorTextureIndex;
  };

  struct Transformation {
    glm::mat4 pointMatrix{1.0f};
    glm::mat4 dirMatrix{1.0f};
    glm::mat4 pointInverseMatrix{1.0f};
    glm::mat4 dirInverseMatrix{1.0f};
    glm::mat4 normalMatrix{1.0f};
  };

  struct PointLight {
    glm::vec4 position{0.0f};
    glm::vec4 color{0.0f};
  };

  struct SpotLight {
    alignas(16) glm::vec4 position;
    alignas(16) glm::vec4 color;
    alignas(16) glm::vec4 direction;
    float angle;
  };

  struct ForwardUbo {
    glm::mat4 cameraTransforms;
  };

  struct RayTraceUbo {
    glm::vec4 origin;
    glm::uvec4 numLights;
  };
}