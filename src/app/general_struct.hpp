#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>
#include <vector>

namespace NugieApp {
  struct Reference {
    uint32_t materialIndex;
    uint32_t transformIndex;
  };

  struct Primitive {
    alignas(16) glm::uvec3 indices;
    uint32_t materialIndex;
  };

  struct Object {
    uint32_t firstBvhIndex = 0;
    uint32_t firstPrimitiveIndex = 0;
    uint32_t transformIndex;
  };

  struct BvhNode {
    uint32_t leftNode = 0;
    uint32_t rightNode = 0;
    uint32_t leftObjIndex = 0;
    uint32_t rightObjIndex = 0;

    alignas(16) glm::vec3 maximum;
    alignas(16) glm::vec3 minimum;
  };

  struct Material {
    alignas(16)  glm::vec3 baseColor;
    float metallicness;
    float roughness;
    float fresnelReflect;
  };

  struct Transformation {
    glm::mat4 pointMatrix{1.0f};
    glm::mat4 dirMatrix{1.0f};
    glm::mat4 pointInverseMatrix{1.0f};
    glm::mat4 dirInverseMatrix{1.0f};
    glm::mat4 normalMatrix{1.0f};
  };

  struct PointLight {
    alignas(16) glm::vec3 position;
    alignas(16) glm::vec3 color;
  };

  struct TriangleLight {
    alignas(16) glm::vec3 point0;
    alignas(16) glm::vec3 point1;
    alignas(16) glm::vec3 point2;

    alignas(16) glm::vec3 color;
  };

  struct SunLight {
    alignas(16) glm::vec3 direction;
    alignas(16) glm::vec3 color;
  };

  struct RayTraceUbo {
    alignas(16) glm::vec3 origin;
    alignas(16) glm::vec3 background;
    uint32_t numLights;
    alignas(16) glm::vec2 screenSize;
  };

  struct RasterUbo {
    glm::mat4 transforms;
  };

  struct RayTracePushConstant {
    uint32_t randomSeed;
  };
}