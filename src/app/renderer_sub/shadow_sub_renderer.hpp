#pragma once

#include "sub_renderer.hpp"
#include "../../vulkan/image/image.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class ShadowSubRenderer : public SubRenderer {
    public:
      class Builder {
        public:
          Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum = 1u);

          Builder& addSubPass(std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, std::vector<VkAttachmentReference> outputAttachmentRefs, VkAttachmentReference depthAttachmentRefs, std::vector<VkAttachmentReference> inputAttachmentRefs = {});
          Builder& addResolveAttachmentRef(VkAttachmentReference resolveAttachmentRef);

          ShadowSubRenderer* build();

        private:
          NugieVulkan::Device* device;
          uint32_t width, height, layerNum;

          std::vector<std::vector<VkImageView>> attachments;
          std::vector<VkAttachmentDescription> attachmentDescs;
          std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs;
          std::vector<VkAttachmentReference> depthAttachmentRefs;
          std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs;
          std::vector<VkAttachmentReference> resolveAttachmentRef;
      };

      ShadowSubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, 
        std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs, std::vector<VkAttachmentReference> depthAttachmentRefs, std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs, 
        std::vector<VkAttachmentReference> resolveAttachmentRef);

      void beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t imageIndex) override;
  };
  
} // namespace NugieApp
