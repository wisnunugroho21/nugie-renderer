#include "transform.hpp"

namespace NugieApp {
  glm::mat4 TransformComponent::getModelMatrix() const {
    auto curTransf = glm::mat4{1.0f};

    curTransf = glm::translate(curTransf, this->translation);
    curTransf = glm::scale(curTransf, this->scale);    

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    return curTransf;
  }

  glm::mat3 TransformComponent::getNormalMatrix() const {
    auto curTransf = glm::mat4{1.0f};

    curTransf = glm::scale(curTransf, this->scale);

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    return glm::inverseTranspose(glm::mat3(curTransf));
  }

  std::vector<Transformation> ConvertComponentToTransform(const std::vector<TransformComponent> &transformations) {
		auto newTransforms = std::vector<Transformation>();
		for (auto &&transform : transformations) {
			newTransforms.emplace_back(Transformation{ 
				transform.getModelMatrix(),
				transform.getNormalMatrix() 
			});
		}

		return newTransforms;
	}

  glm::mat4 RayTransformComponent::getPointMatrix() const {
    auto curTransf = glm::mat4{1.0f};

    curTransf = glm::translate(curTransf, this->translation);
    curTransf = glm::scale(curTransf, this->scale);    

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    return curTransf;
  }

  glm::mat4 RayTransformComponent::getDirMatrix() const {
    auto curTransf = glm::mat4{1.0f};

    curTransf = glm::scale(curTransf, this->scale);

    curTransf = glm::rotate(curTransf, this->rotation.x, glm::vec3(1.0f, 0.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.y, glm::vec3(0.0f, 1.0f, 0.0f));
    curTransf = glm::rotate(curTransf, this->rotation.z, glm::vec3(0.0f, 0.0f, 1.0f));

    return curTransf;
  }

  glm::mat4 RayTransformComponent::getPointInverseMatrix() const {
    return glm::inverse(this->getPointMatrix());
  }

  glm::mat4 RayTransformComponent::getDirInverseMatrix() const {
    return glm::inverse(this->getDirMatrix());
  }

  glm::mat4 RayTransformComponent::getNormalMatrix() const {
    return glm::inverseTranspose(glm::mat3(this->getPointMatrix()));
  }

  std::vector<RayTransformation> ConvertRayComponentToRayTransform(const std::vector<RayTransformComponent> &rayTransformations) {
    auto newTransforms = std::vector<RayTransformation>();
    
    for (auto &&transform : rayTransformations) {
      newTransforms.emplace_back(RayTransformation{ 
        transform.getPointMatrix(),
        transform.getDirMatrix(),
        transform.getPointInverseMatrix(),
        transform.getDirInverseMatrix(),
        transform.getNormalMatrix()
      });
    }

    return newTransforms;
  }
} // namespace NugieApp