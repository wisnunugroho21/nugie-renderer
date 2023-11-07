#include "transform.hpp"

namespace NugieApp {
  glm::mat4 TransformComponent::getPointMatrix() {
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

  glm::mat4 TransformComponent::getPointInverseMatrix() {
    return glm::inverse(this->getPointMatrix());
  }

  glm::mat4 TransformComponent::getDirMatrix() {
    auto curTransf = glm::mat4{1.0f};

    curTransf = glm::scale(curTransf, this->scale);

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    return curTransf;
  }

  glm::mat4 TransformComponent::getDirInverseMatrix() {
    return glm::mat4(glm::inverse(glm::mat3(this->getDirMatrix())));
  }

  glm::mat4 TransformComponent::getNormalMatrix() {
    auto curTransf = glm::mat4{1.0f};

    curTransf = glm::scale(curTransf, this->scale);

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    return glm::mat4(glm::inverseTranspose(glm::mat3(curTransf)));
  }
} // namespace NugieApp