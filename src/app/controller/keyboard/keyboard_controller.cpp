#include "keyboard_controller.hpp"

namespace NugieApp {
    glm::vec3 KeyboardController::moveInPlaceXZ(GLFWwindow *window, float dt, glm::vec3 currentCameraPosition,
                                                glm::vec3 currentCameraDirection, bool *isPressed) const {
        glm::vec3 newCameraPosition = currentCameraPosition;
        glm::vec3 upVector = glm::vec3(0.0f, 1.0f, 0.0f);

        glm::vec3 forwardDir = glm::normalize(currentCameraDirection);
        glm::vec3 rightDir = glm::normalize(glm::cross(forwardDir, upVector));
        glm::vec3 upDir = glm::cross(forwardDir, rightDir);

        glm::vec3 moveDir{0.0f};
        *isPressed = false;

        if (glfwGetKey(window, keymaps.moveForward) == GLFW_PRESS) {
            moveDir += forwardDir;
            *isPressed = true;
        }

        if (glfwGetKey(window, keymaps.moveBackward) == GLFW_PRESS) {
            moveDir -= forwardDir;
            *isPressed = true;
        }

        if (glfwGetKey(window, keymaps.moveRight) == GLFW_PRESS) {
            moveDir += rightDir;
            *isPressed = true;
        }

        if (glfwGetKey(window, keymaps.moveLeft) == GLFW_PRESS) {
            moveDir -= rightDir;
            *isPressed = true;
        }

        if (glfwGetKey(window, keymaps.moveUp) == GLFW_PRESS) {
            moveDir += upDir;
            *isPressed = true;
        }

        if (glfwGetKey(window, keymaps.moveDown) == GLFW_PRESS) {
            moveDir -= upDir;
            *isPressed = true;
        }

        if (glm::dot(moveDir, moveDir) > std::numeric_limits<float>::epsilon()) {
            newCameraPosition += moveSpeed * dt * glm::normalize(moveDir);
        }

        return newCameraPosition;
    }
} // namespace nugiEngin 