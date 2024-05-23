#pragma once

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include "../transform/transform.hpp"
#include "../../general_struct.hpp"

#include <vector>
#include <memory>
#include <algorithm>
#include <stack>

#define SPLIT_NUMBER 12

namespace NugieApp {
  const glm::vec3 eps(0.00001f);

  // Axis-aligned bounding box.
  struct Aabb {
    glm::vec3 min = glm::vec3{FLT_MAX};
    glm::vec3 max = glm::vec3{FLT_MIN};

    float area();

    uint32_t longestAxis();
    uint32_t randomAxis();
  };

  class BoundBox {
    public:
      BoundBox(uint32_t i) : index{i} {}

      uint32_t getIndex() { return this->index; }
      uint32_t getTypeIndex() { return this->typeIndex; }

      virtual Aabb boundingBox() = 0;

      virtual glm::vec3 getOriginalMin() { return glm::vec3(0.0f); }
      virtual glm::vec3 getOriginalMax() { return glm::vec3(0.0f); }

    protected:
      uint32_t index;
      uint32_t typeIndex;
  };

  class TriangleBoundBox : public BoundBox {   
    public:
      TriangleBoundBox(uint32_t i, const Triangle &t, const std::vector<Vertex> &v) : BoundBox(i), triangle{t}, vertices{v} {
        this->typeIndex = 1u;
      }

      Aabb boundingBox();

    private:
      Triangle triangle;
      std::vector<Vertex> vertices;
  };

  class ObjectBoundBox : public BoundBox {
    public:
      ObjectBoundBox(uint32_t i, const Object &o, const TransformComponent &tc, const std::vector<Triangle> &t, const std::vector<Vertex> &v);
      
      glm::vec3 getOriginalMin() { return this->originalMin; }
      glm::vec3 getOriginalMax() { return this->originalMax; }
      
      Aabb boundingBox();

    private:
      Object object;
      TransformComponent transformation;

      std::vector<Triangle> triangles;
      std::vector<Vertex> vertices;

      glm::vec3 originalMin{0.0f};
      glm::vec3 originalMax{0.0f};

      float findMax(uint32_t index);
      float findMin(uint32_t index);
  };

  // Intermediate BvhNode structure needed for constructing Bvh.
  struct BvhItemBuild {
    Aabb box;
    uint32_t index = 0; // index refers to the index in the final array of nodes. Used for sorting a flattened Bvh.
    uint32_t leftNodeIndex = 0;
    uint32_t rightNodeIndex = 0;
    std::vector<BoundBox*> objects;

    BvhNode getGpuModel();
  };

  struct BvhBinSAH {
    Aabb box;
    uint32_t objectCount;
  };

  bool nodeCompare(const BvhItemBuild& a, const BvhItemBuild& b);

  Aabb surroundingBox(Aabb box0, Aabb box1);
  Aabb objectListBoundingBox(const std::vector<BoundBox*> &objects);

  bool boxCompare(BoundBox* a, BoundBox* b, int axis);
  bool boxXCompare(BoundBox* a, BoundBox* b);
  bool boxYCompare(BoundBox* a, BoundBox* b);
  bool boxZCompare(BoundBox* a, BoundBox* b);

  float findTriangleSplitPosition(BvhItemBuild node, int axis, float length);

  // Since GPU can't deal with tree structures we need to create a flattened BVH.
  // Stack is used instead of a tree.
  std::vector<BvhNode> createBvh(const std::vector<BoundBox*> &boundedBoxes);

}// namespace NugieApp 
