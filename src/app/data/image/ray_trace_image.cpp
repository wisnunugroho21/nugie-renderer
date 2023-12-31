#include "ray_trace_image.hpp"

namespace NugieApp {
  RayTraceImage::RayTraceImage(NugieVulkan::Device* device, uint32_t width, uint32_t height)
    : device{device}, width{width}, height{height}
  {
		this->createImages();
    this->createTextures();
  }

  RayTraceImage::~RayTraceImage() {
    for (auto &&rayTraceTexture : this->rayTraceTextures) {
      if (rayTraceTexture != nullptr) delete rayTraceTexture;
    }

    this->deleteImages();
  }

	std::vector<VkDescriptorImageInfo> RayTraceImage::getImagesInfo() {
		std::vector<VkDescriptorImageInfo> imagesInfo{};
		
		for (int i = 0; i < this->rayTraceImages.size(); i++) {
			imagesInfo.emplace_back(this->rayTraceImages[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_GENERAL));
		}

		return imagesInfo;
	}

  std::vector<VkDescriptorImageInfo> RayTraceImage::getTexturesInfo() {
    std::vector<VkDescriptorImageInfo> imagesInfo{};
		
		for (int i = 0; i < this->rayTraceTextures.size(); i++) {
			imagesInfo.emplace_back(this->rayTraceTextures[i]->getDescriptorInfo(VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL));
		}

		return imagesInfo;
  }
  
  void RayTraceImage::createImages() {
    auto msaaSamples = VK_SAMPLE_COUNT_1_BIT;
    auto colorFormat = this->findColorFormat({ VK_FORMAT_R16G16B16A16_SFLOAT, VK_FORMAT_R32G32B32A32_SFLOAT });

    this->rayTraceImages.clear();
		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->rayTraceImages.emplace_back(new NugieVulkan::Image(
        this->device, this->width, this->height, 1, msaaSamples, colorFormat, 
        VK_IMAGE_TILING_OPTIMAL, VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_IMAGE_ASPECT_COLOR_BIT
      ));
		}
  }

  void RayTraceImage::deleteImages() {
    for (auto &&rayTraceImage : this->rayTraceImages) {
      if (rayTraceImage != nullptr) delete rayTraceImage;
    }
  }

  void RayTraceImage::createTextures() {
    for (auto &&rayTraceImage : this->rayTraceImages) {
      this->rayTraceTextures.push_back(new NugieVulkan::Texture(this->device, rayTraceImage, VK_FILTER_NEAREST, 
        VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_BORDER, VK_FALSE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER, 
        VK_SAMPLER_MIPMAP_MODE_NEAREST));
    }
  }

	void RayTraceImage::prepareBarrier(NugieVulkan::CommandBuffer* commandBuffer, uint32_t frameIndex) {
		this->rayTraceImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_GENERAL, 
      VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, VK_ACCESS_SHADER_READ_BIT);
	}

	void RayTraceImage::readToWriteBarrier(NugieVulkan::CommandBuffer* commandBuffer, uint32_t frameIndex) {
		this->rayTraceImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_GENERAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
	}

  void RayTraceImage::writeToReadBarrier(NugieVulkan::CommandBuffer* commandBuffer, uint32_t frameIndex) {
		this->rayTraceImages[frameIndex]->transitionImageLayout(commandBuffer, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, VK_IMAGE_LAYOUT_GENERAL, 
      VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT, VK_ACCESS_SHADER_WRITE_BIT);
	}

  VkFormat RayTraceImage::findColorFormat(const std::vector<VkFormat> &colorFormats) {
    return this->device->findSupportedFormat(
      colorFormats,
      VK_IMAGE_TILING_OPTIMAL,
      VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT);
  }
}