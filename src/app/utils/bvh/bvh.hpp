#pragma once

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include "../transform/transform.hpp"
#include "../../path_tracing_struct.hpp"

#include <vector>
#include <memory>
#include <algorithm>
#include <stack>

#define SPLIT_NUMBER 2

namespace NugieApp {
    // Axis-aligned bounding box.
    struct Aabb {
        glm::vec3 min = glm::vec3{FLT_MAX};
        glm::vec3 max = glm::vec3{FLT_MIN};

        float area() const;

        uint32_t longestAxis();

        static uint32_t randomAxis();
    };

    struct SplitSAHResult {
        int axis;
        float position;
        float cost;
    };

    class BoundBox {
    public:
        BoundBox(uint32_t i) : index{i} {}

        uint32_t getIndex() const { return this->index; }

        uint32_t getTypeIndex() const { return this->typeIndex; }

        virtual Aabb boundingBox() = 0;

        virtual glm::vec3 getOriginalMin() { return glm::vec3(0.0f); }

        virtual glm::vec3 getOriginalMax() { return glm::vec3(0.0f); }

    protected:
        uint32_t index = 0u;
        uint32_t typeIndex = 0u;
    };

    class TriangleBoundBox : public BoundBox {
    public:
        TriangleBoundBox(uint32_t i, const NugiePathTracing::Triangle &t, const std::vector<Vertex> &v) 
                         : BoundBox(i), triangle{t}, vertices{v} 
        {
            this->typeIndex = 1u;
        }

        Aabb boundingBox() override;

    private:
        NugiePathTracing::Triangle triangle{};
        std::vector<Vertex> vertices{};
    };

    class TriangleLightBoundBox : public BoundBox {
    public:
        TriangleLightBoundBox(uint32_t i, const NugiePathTracing::Triangle &t, const std::vector<Vertex> &v) 
                              : BoundBox(i), triangle{t}, vertices{v} 
        {
            this->typeIndex = 2u;
        }

        Aabb boundingBox() override;

    private:
        NugiePathTracing::Triangle triangle{};
        std::vector<Vertex> vertices{};
    };

    class ObjectBoundBox : public BoundBox {
    public:
        ObjectBoundBox(uint32_t i, const NugiePathTracing::Object &o, const TransformComponent &tc, 
                       const std::vector<NugiePathTracing::Triangle> &t,
                       const std::vector<Vertex> &v);

        glm::vec3 getOriginalMin() override { return this->originalMin; }

        glm::vec3 getOriginalMax() override { return this->originalMax; }

        Aabb boundingBox() override;

    private:
        NugiePathTracing::Object object{};
        TransformComponent transformation{};

        std::vector<NugiePathTracing::Triangle> triangles{};
        std::vector<Vertex> vertices{};

        glm::vec3 originalMin{0.0f};
        glm::vec3 originalMax{0.0f};

        float findMax(uint32_t index);

        float findMin(uint32_t index);
    };

    // Intermediate BvhNode structure needed for constructing Bvh.
    struct BvhItemBuild {
        Aabb box;
        uint32_t index = 0u; // index refers to the index in the final array of nodes. Used for sorting a flattened Bvh.
        uint32_t leftNodeIndex = 0u;
        uint32_t rightNodeIndex = 0u;
        std::vector<BoundBox *> objects{};

        NugiePathTracing::BvhNode getGpuModel();
    };

    struct BvhBinSAH {
        Aabb box;
        uint32_t objectCount = 0u;
    };

    bool nodeCompare(const BvhItemBuild &a, const BvhItemBuild &b);

    Aabb surroundingBox(Aabb box0, Aabb box1);

    Aabb objectListBoundingBox(const std::vector<BoundBox *> &objects);

    bool boxCompare(BoundBox *a, BoundBox *b, int axis);

    bool boxXCompare(BoundBox *a, BoundBox *b);

    bool boxYCompare(BoundBox *a, BoundBox *b);

    bool boxZCompare(BoundBox *a, BoundBox *b);

    float evaluateSAH(BvhItemBuild node, int axis, float position);

    SplitSAHResult splitSAH(BvhItemBuild node);

    // Since GPU can't deal with tree structures we need to create a flattened BVH.
    // Stack is used instead of a tree.
    std::vector<NugiePathTracing::BvhNode> createBvh(const std::vector<BoundBox *> &boundedBoxes);

}// namespace NugieApp 
