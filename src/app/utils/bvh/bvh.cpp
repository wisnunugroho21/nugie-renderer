#include "bvh.hpp"

namespace NugieApp {
  float Aabb::area() {
    auto diff = this->max - this->min;
    return diff.x * diff.y + diff.y * diff.z + diff.z * diff.x;
  }

  uint32_t Aabb::longestAxis() {
    float x = abs(max[0] - min[0]);
    float y = abs(max[1] - min[1]);
    float z = abs(max[2] - min[2]);

    uint32_t longest = 0;
    if (y > x && y > z) {
      longest = 1;
    }

    if (z > x && z > y) {
      longest = 2;
    }

    return longest;
  }

  uint32_t Aabb::randomAxis() {
    return arc4random() % 3;
  }

  Aabb PrimitiveBoundBox::boundingBox() {
    return Aabb { 
      glm::vec3(glm::min(glm::min(this->vertices[this->primitive->indices.x], this->vertices[this->primitive->indices.y]), this->vertices[this->primitive->indices.z])) - eps,
      glm::vec3(glm::max(glm::max(this->vertices[this->primitive->indices.x], this->vertices[this->primitive->indices.y]), this->vertices[this->primitive->indices.z])) + eps
    };
  }

  ObjectBoundBox::ObjectBoundBox(uint32_t i, Object* o, std::vector<Primitive> &p, TransformComponent *t, std::vector<glm::vec4> v) : BoundBox(i), object{o}, primitives{p}, transformation{t}, vertices{v} {
    this->originalMin = glm::vec3(this->findMin(0), this->findMin(1), this->findMin(2));
    this->originalMax = glm::vec3(this->findMax(0), this->findMax(1), this->findMax(2));
  }

  Aabb ObjectBoundBox::boundingBox() {
    auto curTransf = glm::mat4{ 1.0f };
    auto originScalePosition = glm::vec3((this->originalMax - this->originalMin) / 2.0f + this->originalMin);

    curTransf = glm::translate(curTransf, this->transformation->translation);
    
    curTransf = glm::translate(curTransf, originScalePosition);
    curTransf = glm::scale(curTransf, this->transformation->scale);    

    curTransf = glm::rotate(curTransf, this->transformation->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->transformation->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->transformation->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    curTransf = glm::translate(curTransf, -1.0f * originScalePosition);

    auto newMin = glm::vec4{FLT_MAX, FLT_MAX, FLT_MAX, 1.0f};
    auto newMax = glm::vec4{FLT_MIN, FLT_MIN, FLT_MIN, 1.0f};

    for (int i = 0; i < 2; i++) {
      for (int j = 0; j < 2; j++) {
        for (int k = 0; k < 2; k++) {
          auto x = i * this->originalMax.x + (1 - i) * this->originalMin.x;
          auto y = j * this->originalMax.y + (1 - j) * this->originalMin.y;
          auto z = k * this->originalMax.z + (1 - k) * this->originalMin.z;

          auto newTransf = curTransf * glm::vec4(x, y, z, 1.0f);

          newMin = glm::min(newMin, newTransf);
          newMax = glm::max(newMax, newTransf);
        }
      }
    }

    return Aabb {
      glm::vec3(newMin) - eps,
      glm::vec3(newMax) + eps
    };
  }

  float ObjectBoundBox::findMax(uint32_t index) {
    float max = FLT_MIN;
    for (auto &&primitive : this->primitives) {
      if (this->vertices[primitive.indices.x][index] > max) max = this->vertices[primitive.indices.x][index];
      if (this->vertices[primitive.indices.y][index] > max) max = this->vertices[primitive.indices.y][index];
      if (this->vertices[primitive.indices.z][index] > max) max = this->vertices[primitive.indices.z][index];
    }

    return max;
  }

  float ObjectBoundBox::findMin(uint32_t index) {
    float min = FLT_MAX;
    for (auto &&primitive : this->primitives) {
      if (this->vertices[primitive.indices.x][index] < min) min = this->vertices[primitive.indices.x][index];
      if (this->vertices[primitive.indices.y][index] < min) min = this->vertices[primitive.indices.y][index];
      if (this->vertices[primitive.indices.z][index] < min) min = this->vertices[primitive.indices.z][index];
    }

    return min;
  }

  BvhNode BvhItemBuild::getGpuModel() {
    bool leaf = leftNodeIndex == 0 && rightNodeIndex == 0;

    BvhNode node{};
    node.minimum = box.min;
    node.maximum = box.max;      

    if (leaf) {
      if (objects.empty()) {
        return node;
      }
      
      node.leftObjIndex = objects[0]->index;

      if (objects.size() > 1) {
        node.rightObjIndex = objects[1]->index;
      }
    } else {
      node.leftNode = leftNodeIndex;
      node.rightNode = rightNodeIndex;
    }

    return node;
  }

  bool nodeCompare(const BvhItemBuild& a, const BvhItemBuild& b) {
    return a.index < b.index;
  }

  Aabb surroundingBox(Aabb box0, Aabb box1) {
    return Aabb{ glm::min(box0.min, box1.min), glm::max(box0.max, box1.max) };
  }

  Aabb objectListBoundingBox(const std::vector<BoundBox*> &objects) {
    Aabb tempBox;
    Aabb outputBox;
    bool firstBox = true;

    for (auto &object : objects) {
      tempBox = object->boundingBox();
      outputBox = firstBox ? tempBox : surroundingBox(outputBox, tempBox);
      firstBox = false;
    }

    return outputBox;
  }

  bool boxCompare(BoundBox* a, BoundBox* b, int axis) {
    Aabb boxA = a->boundingBox();
    Aabb boxB = b->boundingBox();

    float Apos = (boxA.max[axis] - boxA.min[axis]) / 2 + boxA.min[axis];
    float Bpos = (boxB.max[axis] - boxB.min[axis]) / 2 + boxB.min[axis];

    return Apos < Bpos;
  }

  bool boxXCompare(BoundBox* a, BoundBox* b) {
    return boxCompare(a, b, 0);
  }

  bool boxYCompare(BoundBox* a, BoundBox* b) {
    return boxCompare(a, b, 1);
  }

  bool boxZCompare(BoundBox* a, BoundBox* b) {
    return boxCompare(a, b, 2);
  }

  float findPrimitiveSplitPosition(BvhItemBuild node, int axis, float length) {
    float bestCost = 1000000000000.0f;
    float splitPos = 0.0f;

    BvhBinSAH bvhBins[SPLIT_NUMBER];
    float scale = SPLIT_NUMBER / (node.box.max[axis] - node.box.min[axis]);

    for (auto &&item : node.objects) {
      Aabb boundBox = item->boundingBox();
      float pos = (boundBox.max[axis] - boundBox.min[axis]) / 2.0f + boundBox.min[axis];

      int binIdx = glm::min(SPLIT_NUMBER - 1, (int) std::floor((pos - boundBox.min[axis]) * scale));
      BvhBinSAH binSah = bvhBins[binIdx];

      binSah.box.max = glm::max(binSah.box.max, boundBox.max);
      binSah.box.min = glm::min(binSah.box.min, boundBox.min);
      binSah.objectCount++;

      bvhBins[binIdx] = binSah;
    }

    float leftArea[SPLIT_NUMBER - 1], rightArea[SPLIT_NUMBER - 1];
    int leftCount[SPLIT_NUMBER - 1], rightCount[SPLIT_NUMBER - 1];
    Aabb leftBox, rightBox;
    int leftSum = 0, rightSum = 0;

    for (int i = 0; i < SPLIT_NUMBER - 1; i++) {
      leftSum += bvhBins[i].objectCount;
      leftCount[i] = leftSum;

      leftBox.max = glm::max(leftBox.max, bvhBins[i].box.max);
      leftBox.min = glm::min(leftBox.min, bvhBins[i].box.min);
      leftArea[i] = leftBox.area();

      rightSum += bvhBins[i].objectCount;
      rightCount[i] = rightSum;

      rightBox.max = glm::max(rightBox.max, bvhBins[i].box.max);
      rightBox.min = glm::min(rightBox.min, bvhBins[i].box.min);
      rightArea[i] = rightBox.area();
    }

    scale = (node.box.max[axis] - node.box.min[axis]) / SPLIT_NUMBER;
    for (int i = 0; i < SPLIT_NUMBER - 1; i++) {
      float curCost = leftCount[i] * leftArea[i] + rightCount[i] * rightArea[i];
      if (curCost < bestCost) {
        bestCost = curCost;
        splitPos = node.box.min[axis] + scale * (i + 1);
      }
    }

    return splitPos;
  }

  // Since GPU can't deal with tree structures we need to create a flattened BVH.
  // Stack is used instead of a tree.
  std::vector<BvhNode> createBvh(const std::vector<BoundBox*> &boundedBoxes) {
    uint32_t nodeCounter = 1;
    std::vector<BvhItemBuild> intermediate;
    std::stack<BvhItemBuild> nodeStack;

    BvhItemBuild root;
    root.index = nodeCounter;
    root.objects = boundedBoxes;

    nodeCounter++;
    nodeStack.push(root);

    while (!nodeStack.empty()) {
      BvhItemBuild currentNode = nodeStack.top();
      nodeStack.pop();

      currentNode.box = objectListBoundingBox(currentNode.objects);

      int axis = currentNode.box.longestAxis();
      auto comparator = (axis == 0) ? boxXCompare
                      : (axis == 1) ? boxYCompare
                      : boxZCompare;

      size_t objectSpan = currentNode.objects.size();
      std::sort(currentNode.objects.begin(), currentNode.objects.end(), comparator);

      if (objectSpan <= 2) {
        intermediate.push_back(currentNode);
        continue;
      } else {
        float length = currentNode.box.max[axis] - currentNode.box.min[axis];
        float splitPos = findPrimitiveSplitPosition(currentNode, axis, length); //  std::ceil(objectSpan / 2);

        BvhItemBuild leftNode, rightNode;

        for (auto &&item : currentNode.objects) {
          Aabb curBox = item->boundingBox();
          float pos = (curBox.max[axis] - curBox.min[axis]) / 2 + curBox.min[axis];

          if (pos < splitPos) {
            leftNode.objects.push_back(item);
          } else {
            rightNode.objects.push_back(item);
          }
        }

        if (leftNode.objects.size() == 0 || rightNode.objects.size() == 0) {
					int mid = static_cast<int>(std::ceil(objectSpan / 2));

					leftNode.objects.clear();
					rightNode.objects.clear();

					for (int i = 0; i < mid; i++) {
						leftNode.objects.push_back(currentNode.objects[i]);
					}

					for (int i = mid; i < objectSpan; i++) {
						rightNode.objects.push_back(currentNode.objects[i]);
					}
        }        

        leftNode.index = nodeCounter;
        nodeCounter++;
        nodeStack.push(leftNode);

        rightNode.index = nodeCounter;
        nodeCounter++;
        nodeStack.push(rightNode);

        currentNode.leftNodeIndex = leftNode.index;
        currentNode.rightNodeIndex = rightNode.index;
        intermediate.push_back(currentNode);
      }
    }

    std::sort(intermediate.begin(), intermediate.end(), nodeCompare);
    std::vector<BvhNode> output;

    for (int i = 0; i < intermediate.size(); i++) {
      output.emplace_back(intermediate[i].getGpuModel());
    }

    return output;
  }
}