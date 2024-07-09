#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE

#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugiePathTracing {
    struct Vertex {
        alignas(16) glm::vec3 position;

        bool operator==(const Vertex &other) const {
            return this->position == other.position;
        }
    };

    struct Triangle {
        glm::uvec4 vertexMaterialIndexes;
    };

    struct Object {
        uint32_t firstBvhIndex;
        uint32_t firstGeometryIndex;
        uint32_t transformIndex;
        uint32_t dummyIndex;
    };

    struct BvhNode {
        uint32_t leftNode = 0u;
        uint32_t rightNode = 0u;
        uint32_t objIndex = 0u;
        uint32_t typeIndex = 0u;

        alignas(16) glm::vec3 maximum{0.0f};
        alignas(16) glm::vec3 minimum{0.0f};
    };

    struct Ubo {
        alignas(16) glm::vec3 origin{0.0f};
        alignas(16) glm::vec3 horizontal{0.0f};
        alignas(16) glm::vec3 vertical{0.0f};
        alignas(16) glm::vec3 lowerLeftCorner{0.0f};
        alignas(16) glm::uvec4 imgSizeRandomSeedNumLight{0u};
    };
}