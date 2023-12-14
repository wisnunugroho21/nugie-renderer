#include "mouse_controller.hpp"

namespace NugieApp {
  glm::vec3 MouseController::rotateInPlaceXZ(GLFWwindow* window, float dt, glm::vec3 currentCameraDirection, bool* isPressed) {
    glm::vec3 newCameraDirection = currentCameraDirection;

    if (glfwGetMouseButton(window, this->keymaps.rightButton) == GLFW_PRESS) {
      glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
      *isPressed = true;

      double curDragged_x = 0;
      double curDragged_y = 0;

      glfwGetCursorPos(window, &curDragged_x, &curDragged_y);

      if (!this->isFirstPressed) {
        float theta = glm::radians((curDragged_y - this->lastDragged_y) * dt * this->lookSpeed);
        float phi = glm::radians((curDragged_x - this->lastDragged_x) * dt * this->lookSpeed);

        newCameraDirection.x = glm::cos(phi) * currentCameraDirection.x + glm::sin(phi) * currentCameraDirection.z;
        newCameraDirection.z = -1.0f * glm::sin(phi) * currentCameraDirection.x + glm::cos(phi) * currentCameraDirection.z;

        newCameraDirection.y = glm::cos(theta) * currentCameraDirection.y - glm::sin(theta) * currentCameraDirection.z;
        newCameraDirection.z = glm::sin(theta) * currentCameraDirection.y + glm::cos(theta) * currentCameraDirection.z;
      }

      this->lastDragged_x = curDragged_x;
      this->lastDragged_y = curDragged_y;
      this->isFirstPressed = false;

    } else if (glfwGetMouseButton(window, this->keymaps.rightButton) == GLFW_RELEASE) {
      this->lastDragged_x = 0;
      this->lastDragged_y = 0;
      this->isFirstPressed = true;

      glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
      *isPressed = false;
    }

    return newCameraDirection;
  }
} // namespace nugiEngin 