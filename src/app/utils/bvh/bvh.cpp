#include "bvh.hpp"

#include <array>
#include <algorithm>

namespace NugieApp {
    float Aabb::area() const {
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
        return rand() % 3;
    }

    Aabb TriangleBoundBox::boundingBox() {
        return Aabb{
                glm::vec3(
                    glm::min(
                        glm::min(
                                    this->vertices[this->triangle.vertexMaterialIndexes.x].position,
                                    this->vertices[this->triangle.vertexMaterialIndexes.y].position
                                ),
                                this->vertices[this->triangle.vertexMaterialIndexes.z].position)
                        ),
                glm::vec3(
                    glm::max(
                        glm::max(
                                    this->vertices[this->triangle.vertexMaterialIndexes.x].position,
                                    this->vertices[this->triangle.vertexMaterialIndexes.y].position
                                ),
                                this->vertices[this->triangle.vertexMaterialIndexes.z].position
                            )
                        )
        };
    }

    Aabb TriangleLightBoundBox::boundingBox() {
        return Aabb{
                glm::vec3(
                    glm::min(
                        glm::min(
                                    this->vertices[this->triangle.vertexMaterialIndexes.x].position,
                                    this->vertices[this->triangle.vertexMaterialIndexes.y].position
                                ),
                                this->vertices[this->triangle.vertexMaterialIndexes.z].position)
                        ),
                glm::vec3(
                    glm::max(
                        glm::max(
                                this->vertices[this->triangle.vertexMaterialIndexes.x].position,
                                this->vertices[this->triangle.vertexMaterialIndexes.y].position
                                ),
                                this->vertices[this->triangle.vertexMaterialIndexes.z].position
                            )
                        )
        };
    }

    ObjectBoundBox::ObjectBoundBox(uint32_t i, const Object &o, const TransformComponent &tc,
                                   const std::vector<Triangle> &t, const std::vector<Vertex> &v) 
                                   : BoundBox(i), object{o}, transformation{tc}, triangles{t}, vertices{v} 
    {
        this->typeIndex = 0u;
        this->originalMin = glm::vec3(this->findMin(0), this->findMin(1), this->findMin(2));
        this->originalMax = glm::vec3(this->findMax(0), this->findMax(1), this->findMax(2));
    }

    Aabb ObjectBoundBox::boundingBox() {
        auto curTransf = glm::mat4{1.0f};
        auto originScalePosition = glm::vec3((this->originalMax - this->originalMin) / 2.0f + this->originalMin);

        curTransf = glm::translate(curTransf, this->transformation.translation);

        curTransf = glm::translate(curTransf, originScalePosition);
        curTransf = glm::scale(curTransf, this->transformation.scale);

        curTransf = glm::rotate(curTransf, this->transformation.rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
        curTransf = glm::rotate(curTransf, this->transformation.rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
        curTransf = glm::rotate(curTransf, this->transformation.rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

        curTransf = glm::translate(curTransf, -1.0f * originScalePosition);

        auto newMin = glm::vec4{FLT_MAX, FLT_MAX, FLT_MAX, 1.0f};
        auto newMax = glm::vec4{FLT_MIN, FLT_MIN, FLT_MIN, 1.0f};

        for (int i = 0; i < 2; i++) {
            for (int j = 0; j < 2; j++) {
                for (int k = 0; k < 2; k++) {
                    auto x = static_cast<float>(i) * this->originalMax.x + static_cast<float>(1 - i) * this->originalMin.x;
                    auto y = static_cast<float>(j) * this->originalMax.y + static_cast<float>(1 - j) * this->originalMin.y;
                    auto z = static_cast<float>(k) * this->originalMax.z + static_cast<float>(1 - k) * this->originalMin.z;

                    auto newTransf = curTransf * glm::vec4(x, y, z, 1.0f);

                    newMin = glm::min(newMin, newTransf);
                    newMax = glm::max(newMax, newTransf);
                }
            }
        }

        return Aabb{
                glm::vec3(newMin),
                glm::vec3(newMax)
        };
    }

    float ObjectBoundBox::findMax(uint32_t index) {
        float max = FLT_MIN;
        for (auto &&triangle: this->triangles) {
            if (this->vertices[triangle.vertexMaterialIndexes.x].position[index] > max)
                max = this->vertices[triangle.vertexMaterialIndexes.x].position[index];
            if (this->vertices[triangle.vertexMaterialIndexes.y].position[index] > max)
                max = this->vertices[triangle.vertexMaterialIndexes.y].position[index];
            if (this->vertices[triangle.vertexMaterialIndexes.z].position[index] > max)
                max = this->vertices[triangle.vertexMaterialIndexes.z].position[index];
        }

        return max;
    }

    float ObjectBoundBox::findMin(uint32_t index) {
        float min = FLT_MAX;
        for (auto &&triangle: this->triangles) {
            if (this->vertices[triangle.vertexMaterialIndexes.x].position[index] < min)
                min = this->vertices[triangle.vertexMaterialIndexes.x].position[index];
            if (this->vertices[triangle.vertexMaterialIndexes.y].position[index] < min)
                min = this->vertices[triangle.vertexMaterialIndexes.y].position[index];
            if (this->vertices[triangle.vertexMaterialIndexes.z].position[index] < min)
                min = this->vertices[triangle.vertexMaterialIndexes.z].position[index];
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

            node.objIndex = objects[0]->getIndex();
            node.typeIndex = objects[0]->getTypeIndex();
        } else {
            node.leftNode = leftNodeIndex;
            node.rightNode = rightNodeIndex;
        }

        return node;
    }

    bool nodeCompare(const BvhItemBuild &a, const BvhItemBuild &b) {
        return a.index < b.index;
    }

    Aabb surroundingBox(Aabb box0, Aabb box1) {
        return Aabb{glm::min(box0.min, box1.min), glm::max(box0.max, box1.max)};
    }

    Aabb objectListBoundingBox(const std::vector<BoundBox *> &objects) {
        Aabb tempBox;
        Aabb outputBox;
        bool firstBox = true;

        for (auto &object: objects) {
            tempBox = object->boundingBox();
            outputBox = firstBox ? tempBox : surroundingBox(outputBox, tempBox);
            firstBox = false;
        }

        return outputBox;
    }

    bool boxCompare(BoundBox *a, BoundBox *b, int axis) {
        Aabb boxA = a->boundingBox();
        Aabb boxB = b->boundingBox();

        float Apos = (boxA.max[axis] - boxA.min[axis]) / 2 + boxA.min[axis];
        float Bpos = (boxB.max[axis] - boxB.min[axis]) / 2 + boxB.min[axis];

        return Apos < Bpos;
    }

    bool boxXCompare(BoundBox *a, BoundBox *b) {
        return boxCompare(a, b, 0);
    }

    bool boxYCompare(BoundBox *a, BoundBox *b) {
        return boxCompare(a, b, 1);
    }

    bool boxZCompare(BoundBox *a, BoundBox *b) {
        return boxCompare(a, b, 2);
    }

    float evaluateSAH(BvhItemBuild node, int axis, float position) {
        Aabb leftBox{}, rightBox{};
        int leftSum = 0, rightSum = 0;

        for (auto &&object : node.objects) {
            Aabb boundBox = object->boundingBox();
            float objectPosition = (boundBox.max[axis] - boundBox.min[axis]) / 2.0f + boundBox.min[axis];

            if (objectPosition < position) {
                leftBox.max = glm::max(leftBox.max, boundBox.max);
                leftBox.min = glm::min(leftBox.min, boundBox.min);
                leftSum++;
            } else {
                rightBox.max = glm::max(leftBox.max, boundBox.max);
                rightBox.min = glm::min(leftBox.min, boundBox.min);
                rightSum++;
            }
        }

        float cost = leftSum * leftBox.area() + rightSum * rightBox.area();
        return cost > 0 ? cost : FLT_MAX;
    }

    /* SplitSAHResult splitSAH(BvhItemBuild node) {
        int bestAxis = -1;
        float bestPosition = 0.0f, bestCost = FLT_MAX;

        for (int axis = 0; axis < 3; axis++) {
            for (auto &&object : node.objects) {
                Aabb boundBox = object->boundingBox();
                float objectPosition = (boundBox.max[axis] - boundBox.min[axis]) / 2.0f + boundBox.min[axis];

                float cost = evaluateSAH(node, axis, objectPosition);
                if (cost < bestCost) {
                    bestPosition = objectPosition;
                    bestAxis = axis;
                    bestCost = cost;
                }
            }
        }

        return SplitSAHResult {
            bestAxis, 
            bestPosition,
            bestCost
        };
    } */

    SplitSAHResult splitSAH(BvhItemBuild node) {
        int bestAxis = -1;
        float bestPosition = 0.0f, bestCost = FLT_MAX;

        for (int axis = 0; axis < 3; axis++) {
            if (node.box.max[axis] == node.box.min[axis]) {
                continue;
            }

            std::array<BvhBinSAH, SPLIT_NUMBER> bins;
            bins.fill(BvhBinSAH{});

            float scale = SPLIT_NUMBER / (node.box.max[axis] - node.box.min[axis]);
            for (auto &&object : node.objects) {
                Aabb boundBox = object->boundingBox();
                float objectPosition = (boundBox.max[axis] - boundBox.min[axis]) / 2.0f + boundBox.min[axis];

                float initIdx = std::ceil((objectPosition - node.box.min[axis]) * scale);
                int binIdx = std::min(SPLIT_NUMBER - 1, static_cast<int>(initIdx));
                
                bins[binIdx].objectCount++;
                bins[binIdx].box.max = glm::max(bins[binIdx].box.max, boundBox.max);
                bins[binIdx].box.min = glm::min(bins[binIdx].box.min, boundBox.min);
            }

            float leftArea[SPLIT_NUMBER - 1], rightArea[SPLIT_NUMBER - 1];
            int leftCount[SPLIT_NUMBER - 1], rightCount[SPLIT_NUMBER - 1];
            Aabb leftBox{}, rightBox{};
            int leftSum = 0, rightSum = 0;

            for (int i = 0; i < SPLIT_NUMBER - 1; i++)
            {
                leftSum += bins[i].objectCount;
                leftCount[i] = leftSum;

                leftBox.max = glm::max(leftBox.max, bins[i].box.max);
                leftBox.min = glm::min(leftBox.min, bins[i].box.min);
                
                leftArea[i] = leftBox.area();

                rightSum += bins[SPLIT_NUMBER - 1 - i].objectCount;
                rightCount[SPLIT_NUMBER - 2 - i] = rightSum;

                rightBox.max = glm::max(rightBox.max, bins[SPLIT_NUMBER - 1 - i].box.max);
                rightBox.min = glm::min(rightBox.min, bins[SPLIT_NUMBER - 1 - i].box.min);
                
                rightArea[SPLIT_NUMBER - 2 - i] = rightBox.area();
            }

            scale = (node.box.max[axis] - node.box.min[axis]) / SPLIT_NUMBER;
            for (int i = 0; i < SPLIT_NUMBER - 1; i++)
            {
                float planeCost = leftCount[i] * leftArea[i] 
                                + rightCount[i] * rightArea[i];

                if (planeCost < bestCost) {
                    bestAxis = axis;
                    bestPosition = node.box.min[axis] + scale * (i + 1);
                    bestCost = planeCost;
                }
                
            }
        }

        return SplitSAHResult {
            bestAxis, 
            bestPosition,
            bestCost
        };
    }

    // Since GPU can't deal with tree structures we need to create a flattened BVH.
    // Stack is used instead of a tree.
    std::vector<BvhNode> createBvh(const std::vector<BoundBox *> &boundedBoxes) {
        uint32_t nodeCounter = 1u;

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
            size_t objectSpan = currentNode.objects.size();

            if (objectSpan == 1) {
                intermediate.push_back(currentNode);
            } else {
                BvhItemBuild leftNode, rightNode;
                SplitSAHResult result = splitSAH(currentNode);

                float currentCost = currentNode.objects.size() * currentNode.box.area();
                if (result.cost >= currentCost) {
                    int axis = currentNode.box.longestAxis();
                    auto comparator = (axis == 0) ? boxXCompare
                                    : (axis == 1) ? boxYCompare
                                    : boxZCompare;

                    std::sort(currentNode.objects.begin(), currentNode.objects.end(), comparator);
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

                else {
                    leftNode.objects.clear();
                    rightNode.objects.clear();

                    for (auto &&object : currentNode.objects) {
                        Aabb boundBox = object->boundingBox();
                        float objectPosition = (boundBox.max[result.axis] - boundBox.min[result.axis]) / 2.0f + boundBox.min[result.axis];

                        if (objectPosition < result.position) {
                            leftNode.objects.push_back(object);
                        } else {
                            rightNode.objects.push_back(object);
                        }
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

        output.reserve(intermediate.size());
        for (auto & i : intermediate) {
            output.emplace_back(i.getGpuModel());
        }

        return output;
    }
}