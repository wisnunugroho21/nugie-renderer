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
    glm::vec4 normal;

   bool operator == (const Vertex &other) const {
			return this->position == other.position && this->normal == other.normal;
		}
  };

  struct Triangle {
    glm::uvec4 vertexMaterialIndexes;
  };

  struct Object {
    glm::uvec4 firstBvhGeometryTransformIndex;
  };

  struct BvhNode {
    glm::uvec4 leftRightNodeObjTypeIndex;
    glm::vec4 maximum;
    glm::vec4 minimum;
  };

  struct Material {
    glm::vec4 baseColor;
  };

  struct Transformation {
    glm::mat4 pointMatrix;
    glm::mat4 dirMatrix;
    glm::mat4 pointInverseMatrix;
    glm::mat4 dirInverseMatrix;
    glm::mat4 normalMatrix;
  };

  struct Ray {
    glm::vec4 origin;
    glm::vec4 direction;
  };

  struct RayTraceUbo {
    glm::vec4 origin;
    glm::vec4 horizontal;
    glm::vec4 vertical;
    glm::vec4 lowerLeftCorner;
    glm::uvec4 imgSizeRandomSeedNumLight;
  };
}