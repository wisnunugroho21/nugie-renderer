#pragma once

#include <vulkan/vulkan.h>

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE

#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <vector>

namespace NugiePathTracing {
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

    struct BvhNodeIndex {
        uint32_t leftNode = 0u;
        uint32_t rightNode = 0u;
        uint32_t objIndex = 0u;
        uint32_t typeIndex = 0u;
    };

    struct BvhNodeMaximum {
        alignas(16) glm::vec3 maximum;
    };

    struct BvhNodeMinimum {
        alignas(16) glm::vec3 minimum;
    };

    struct Ubo {
        alignas(16) glm::vec3 origin{0.0f};
        alignas(16) glm::vec3 horizontal{0.0f};
        alignas(16) glm::vec3 vertical{0.0f};
        alignas(16) glm::vec3 lowerLeftCorner{0.0f};
        alignas(16) glm::uvec4 imgSizeRandomSeedNumLight{0u};
    };
}