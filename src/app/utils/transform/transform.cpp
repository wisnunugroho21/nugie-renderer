#include "transform.hpp"

namespace NugieApp {
  glm::mat4 TransformComponent::getObjectToWorldMatrix() const {
    auto curTransf = glm::mat4{1.0f};
    auto originScalePosition = (this->objectMaximum - this->objectMinimum) / 2.0f + this->objectMinimum;

    curTransf = glm::translate(curTransf, this->translation);
    
    curTransf = glm::translate(curTransf, originScalePosition);
    curTransf = glm::scale(curTransf, this->scale);    

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    curTransf = glm::translate(curTransf, -1.0f * originScalePosition);

    return curTransf;
  }

  glm::mat4 TransformComponent::getWorldToObjectMatrix() const {
    return glm::inverse(this->getObjectToWorldMatrix());
  }

  std::vector<Transformation> ConvertComponentToTransform(const std::vector<TransformComponent> &transformations) {
    std::vector<Transformation> newTransforms;
    
    for (auto &&transform : transformations) {
      newTransforms.emplace_back(Transformation{ 
        transform.getWorldToObjectMatrix(),
        transform.getObjectToWorldMatrix()
      });
    }

    return newTransforms;
  }
} // namespace NugieApp