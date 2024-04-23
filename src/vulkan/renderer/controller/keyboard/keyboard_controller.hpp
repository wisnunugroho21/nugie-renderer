#pragma once

#include "../../camera/camera.hpp"
#include "../../../object/window/window.hpp"

namespace NugieApp {
  class KeyboardController
  {
    public:
      struct KeyMappings {
        int moveLeft = GLFW_KEY_A;
        int moveRight = GLFW_KEY_D;
        int moveForward = GLFW_KEY_W;
        int moveBackward = GLFW_KEY_S;
        int moveUp = GLFW_KEY_E;
        int moveDown = GLFW_KEY_Q;
        int lookLeft = GLFW_KEY_LEFT;
        int lookRight = GLFW_KEY_RIGHT;
        int lookUp = GLFW_KEY_UP;
        int lookDown = GLFW_KEY_DOWN;
      };

      glm::vec3 moveInPlaceXZ(GLFWwindow* window, float dt, glm::vec3 currentCameraPosition, glm::vec3 currentCameraDirection, bool* isPressed);

      KeyMappings keymaps{};
      float moveSpeed{100.0f};
  };

}