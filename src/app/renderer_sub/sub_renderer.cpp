#include "sub_renderer.hpp"

#include <assert.h>
#include <array>

namespace NugieApp {
  SubRenderer::Builder::Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum) 
    : device{device}, width{width}, height{height}, layerNum{layerNum}
  {

  }

  SubRenderer::Builder& SubRenderer::Builder::addSubPass(const std::vector<std::vector<VkImageView>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
    const std::vector<VkAttachmentReference> &outputAttachmentRefs, VkAttachmentReference depthAttachmentRefs, const std::vector<VkAttachmentReference> &inputAttachmentRefs) 
  {
    for (auto &&attachment : attachments) {
      this->attachments.emplace_back(attachment);
    }

    for (auto &&attachmentDesc : attachmentDescs) {
      this->attachmentDescs.emplace_back(attachmentDesc);
    }
    
    this->outputAttachmentRefs.emplace_back(outputAttachmentRefs);
    this->inputAttachmentRefs.emplace_back(inputAttachmentRefs);
    this->depthAttachmentRefs.emplace_back(depthAttachmentRefs);

    return *this;
  }

  SubRenderer::Builder& SubRenderer::Builder::addResolveAttachmentRef(VkAttachmentReference resolveAttachmentRef) {
    this->resolveAttachmentRef.clear();
    this->resolveAttachmentRef.emplace_back(resolveAttachmentRef);

    return *this;
  }

  SubRenderer* SubRenderer::Builder::build() {
    return new SubRenderer(this->device, this->width, this->height, this->layerNum, this->attachments, this->attachmentDescs, 
      this->outputAttachmentRefs, this->depthAttachmentRefs, this->inputAttachmentRefs, this->resolveAttachmentRef);
  }

  SubRenderer::SubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, const std::vector<std::vector<VkImageView>> &attachments, 
    const std::vector<VkAttachmentDescription> &attachmentDescs, const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, 
    const std::vector<VkAttachmentReference> &depthAttachmentRefs, const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, 
    const std::vector<VkAttachmentReference> &resolveAttachmentRef)
    : device{device}, width{width}, height{height}, layerNum{layerNum}
  {
    this->createRenderPass(attachments, attachmentDescs, outputAttachmentRefs, depthAttachmentRefs, inputAttachmentRefs, resolveAttachmentRef);
  }

  SubRenderer::~SubRenderer() {
    if (this->renderPass != nullptr) delete this->renderPass;
  }

  void SubRenderer::createRenderPass(const std::vector<std::vector<VkImageView>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
    const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
    const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, const std::vector<VkAttachmentReference> &resolveAttachmentRef)
  {
    std::vector<VkSubpassDescription> subpasses;
    std::vector<VkSubpassDependency> subpassDependencies;

    this->clearValues.clear();
    for (size_t i = 0; i < depthAttachmentRefs.size(); i++) {
      VkSubpassDescription subpass{};

      subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
      subpass.inputAttachmentCount = static_cast<uint32_t>(inputAttachmentRefs[i].size());
      subpass.pInputAttachments = inputAttachmentRefs[i].size() > 0 ? inputAttachmentRefs[i].data() : nullptr;
      subpass.colorAttachmentCount = static_cast<uint32_t>(outputAttachmentRefs[i].size());
      subpass.pColorAttachments = outputAttachmentRefs[i].size() > 0 ? outputAttachmentRefs[i].data() : nullptr;
      subpass.pDepthStencilAttachment = &depthAttachmentRefs[i];

      subpasses.emplace_back(subpass);

      for (auto &&outputAttachmentRef : outputAttachmentRefs[i]) {
        VkClearValue clearValue;
        clearValue.color = {0.0f, 0.0f, 0.0f, 1.0f};

        this->clearValues.emplace_back(clearValue);
      }
      
      VkClearValue clearValue;
      clearValue.depthStencil = {1.0f, 0};

      this->clearValues.emplace_back(clearValue);
    }

    if (resolveAttachmentRef.size() > 0) {
      subpasses[subpasses.size() - 1].pResolveAttachments = &resolveAttachmentRef[0];
    }

    auto renderPassBuilder = NugieVulkan::RenderPass::Builder(this->device, this->width, this->height, this->layerNum);
    for (size_t i = 0; i < subpasses.size(); i++) {
      renderPassBuilder = renderPassBuilder
        .addSubpass(subpasses[i]);
    }

    for (size_t i = 0; i < attachmentDescs.size(); i++) {
      renderPassBuilder = renderPassBuilder
        .addAttachment(attachmentDescs[i]);
    }

    for (size_t i = 0; i < attachments[0].size(); i++) {
      std::vector<VkImageView> imageViews;
      for (size_t j = 0; j < attachments.size(); j++) {
        imageViews.emplace_back(attachments[j][i]);
      }

      renderPassBuilder = renderPassBuilder.addViewImages(imageViews);
    }

    for (size_t i = 0; i < subpasses.size() - 1; i++) {
      VkSubpassDependency dependency{};
      dependency.srcSubpass = i;
      dependency.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
      dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
      dependency.dstSubpass = i + 1;
      dependency.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
      dependency.dstAccessMask = VK_ACCESS_INPUT_ATTACHMENT_READ_BIT;
      dependency.dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

      renderPassBuilder = renderPassBuilder.addDependency(dependency);
    }

    if (outputAttachmentRefs.size() > 0 && resolveAttachmentRef.size() == 0) {
      VkSubpassDependency postColorDependency{};
      postColorDependency.srcSubpass = static_cast<uint32_t>(subpasses.size() - 1);
      postColorDependency.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
      postColorDependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
      postColorDependency.dstSubpass = VK_SUBPASS_EXTERNAL;
      postColorDependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
      postColorDependency.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
      postColorDependency.dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

      renderPassBuilder = renderPassBuilder.addDependency(postColorDependency);
    } 
    
    else if (depthAttachmentRefs.size() > 0) {
      VkSubpassDependency postDepthDependency{};
      postDepthDependency.srcSubpass = static_cast<uint32_t>(subpasses.size() - 1);
      postDepthDependency.srcAccessMask = VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
      postDepthDependency.srcStageMask = VK_PIPELINE_STAGE_LATE_FRAGMENT_TESTS_BIT;
      postDepthDependency.dstSubpass = VK_SUBPASS_EXTERNAL;
      postDepthDependency.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
      postDepthDependency.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
      postDepthDependency.dependencyFlags = VK_DEPENDENCY_BY_REGION_BIT;

      renderPassBuilder = renderPassBuilder.addDependency(postDepthDependency);
    }

    this->renderPass = renderPassBuilder.build();
  }

  void SubRenderer::beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t imageIndex) {
		VkRenderPassBeginInfo renderBeginInfo{};
		renderBeginInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
		renderBeginInfo.renderPass = this->getRenderPass()->getRenderPass();
		renderBeginInfo.framebuffer = this->getRenderPass()->getFramebuffers(imageIndex);

		renderBeginInfo.renderArea.offset = { 0, 0 };
		renderBeginInfo.renderArea.extent = { static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height) };
		renderBeginInfo.clearValueCount = static_cast<uint32_t>(this->clearValues.size());
		renderBeginInfo.pClearValues = this->clearValues.data();

		vkCmdBeginRenderPass(commandBuffer->getCommandBuffer(), &renderBeginInfo, VK_SUBPASS_CONTENTS_INLINE);

		VkViewport viewport{};
		viewport.x = 0.0f;
		viewport.y = 0.0f;
		viewport.width = static_cast<float>(this->width);
		viewport.height = static_cast<float>(this->height);
		viewport.minDepth = 0.0f;
		viewport.maxDepth = 1.0f;

		VkRect2D scissor{ {0, 0}, { static_cast<uint32_t>(this->width), static_cast<uint32_t>(this->height) }};
    
		vkCmdSetViewport(commandBuffer->getCommandBuffer(), 0, 1, &viewport);
		vkCmdSetScissor(commandBuffer->getCommandBuffer(), 0, 1, &scissor);
	}

  void SubRenderer::nextSubpass(NugieVulkan::CommandBuffer* commandBuffer, VkSubpassContents subPassContent) {
    vkCmdNextSubpass(commandBuffer->getCommandBuffer(), subPassContent);
  }

	void SubRenderer::endRenderPass(NugieVulkan::CommandBuffer* commandBuffer) {
		vkCmdEndRenderPass(commandBuffer->getCommandBuffer());
	}
  
} // namespace NugieApp
